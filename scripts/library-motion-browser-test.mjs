// Same real App/DirectoryTree suite, but with the production Tiptap editor and a long synthetic note.
process.env.NOTEFLOW_MOTION_REAL_EDITOR = '1';
await import('./library-navigation-browser-test.mjs');
