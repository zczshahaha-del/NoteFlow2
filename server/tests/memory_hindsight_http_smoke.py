"""Actual HTTP authentication + background worker smoke; synthetic user is removed."""
import asyncio
import json
import uuid
import sys
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

import httpx
from sqlalchemy import delete
from app.database import AsyncSessionLocal, engine
from app.models.db import User, UserSession, IntegrationOutbox
from app.providers.hindsight import HindsightProvider
from app.utils import create_token


async def main():
    user_id, session_id = 'memory-http-' + uuid.uuid4().hex[:12], uuid.uuid4().hex
    email = user_id + '@example.invalid'
    port = (Path(__file__).resolve().parents[1] / '.dev-api-port').read_text().strip()
    try:
        async with AsyncSessionLocal() as session:
            session.add(User(id=user_id, email=email, display_name='Synthetic', email_verified_at=datetime.utcnow()))
            await session.flush()
            session.add(UserSession(id=session_id, user_id=user_id, expires_at=datetime.utcnow() + timedelta(minutes=10)))
            await session.commit()
        async with httpx.AsyncClient(base_url='http://127.0.0.1:' + port, timeout=40) as client:
            assert (await client.get('/api/memory-console')).status_code == 401
            client.headers['Authorization'] = 'Bearer ' + create_token(user_id, email, 'Synthetic', session_id)
            assert (await client.get('/api/memory-console')).json()['engine'] == 'hindsight'
            result = await client.post('/api/memories', json={'content':'我希望用通俗的中文和简短例子解释技术问题。','memoryType':'preference'})
            assert result.status_code == 200, (result.status_code, result.text[:200])
            memory = result.json()['memory']
            assert memory['provider'] == 'hindsight'
            context = await client.get('/api/memories/context', params={'query':'用户的技术讲解偏好'})
            assert context.status_code == 200 and '中文' in context.json()['context']
            overview = (await client.get('/api/memory-console')).json()
            assert any(j['status'] == 'succeeded' for j in overview['jobs'])
            if '--outage' in sys.argv:
                subprocess.run(['docker','stop','noteflow-hindsight'],check=True,capture_output=True)
                try:
                    assert (await client.get('/api/memories')).status_code == 503
                    response = await client.post('/api/agent/chat',json={
                        'question':'按我习惯的风格，用一句话解释缓存。','mode':'chat','maxTokens':128,'memoryEnabled':True})
                    assert response.status_code == 200
                    events=[json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ') and line != 'data: [DONE]']
                    assert any(e.get('type') == 'agent_done' and e.get('status') == 'completed' for e in events), response.text[:300]
                    assert any(e.get('choices') for e in events)
                    failure = await client.post('/api/memories',json={'content':'我喜欢先给结论再给例子。'})
                    assert failure.status_code == 503, failure.text[:200]
                finally:
                    subprocess.run(['docker','start','noteflow-hindsight'],check=True,capture_output=True)
                    for _ in range(60):
                        try:
                            if (await client.get('http://127.0.0.1:8888/health')).status_code == 200: break
                        except httpx.HTTPError: pass
                        await asyncio.sleep(.5)
            print(json.dumps({'ok':True,'realHttp':True,'sessionAuth':True,'backgroundWorker':True,'sharedContext':True,'realOutage':'--outage' in sys.argv}))
    finally:
        await HindsightProvider().delete_bank(user_id)
        async with AsyncSessionLocal() as session:
            await session.execute(delete(IntegrationOutbox).where(IntegrationOutbox.user_id == user_id))
            await session.execute(delete(User).where(User.id == user_id))
            await session.commit()
        await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
