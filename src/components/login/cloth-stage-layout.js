// A viewport-wide entrance with a bounded character size and the original 3.08s landing.
// Wider paths need more planted steps, not an enlarged actor or sliding feet.
export function clothStageLayout(width,height) {
  const CW=width<440?Math.min(228,width-96):326,CH=448;
  const OX=Math.min(width-CW-14,(width-CW)/2+(width<410?34:width<560?48:65));
  // Center the resting card + 12px gap + 44px account actions as one composition.
  const OY=Math.max(80,(height-CH-56)/2),S=width<410?.74:width<560?.98:1.16;
  const steps=Math.max(6,2*Math.ceil((width+32-OX)/(150*S)));
  const STEP=(3.08-.20)/steps,LIFT=STEP*(.40/.48);
  return {CW,CH,OX,OY,S,ground:OY+CH+12,endX:OX,steps,STEP,LIFT};
}
