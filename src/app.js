const VERSION = "0.35";
// ══════════════════════════════════════════════════════
//  HUSH OS v0.35
//  640×360 internal canvas, full-res glow layer
//
//  Key fixes vs previous build:
//  - City parallax: buildings stored at PIXEL x positions
//    offset wraps correctly, no drift
//  - 2.5D perspective floor with vanishing point
//  - Richer room with proper depth layering
//  - Volumetric neon glow via separate screen-blend canvas
//  - SNES-era colour depth: rich gradients, anti-aliased
//    geometry, dithered light falloff
// ══════════════════════════════════════════════════════

const RW=640, RH=360;
let SCALE=1;

// ── STATE ──────────────────────────────────────────────
const S={
  t:0, mx:0, my:0,
  plx:0,            // smooth parallax X  −10..10
  focus:null, hover:null,
  audioReady:false,
  radioOn:false, radioSt:1, radioVol:.58,
  radioTune:1, radioTuneTarget:1, radioStatic:0, radioDrag:false, radioWasDragged:false,
  radioKnobVel:0, radioDeskKick:0, radioClickCooldown:0,
  tvOn:true, tvCh:0, tvFlicker:0, tvBloom:0,
  tvPowerPending:null, tvPowerTimer:0, tvHumPulse:0,
  winOpen:false, winAnim:0, windowLean:false, leanAnim:0, lampOn:true,
  winAirPulse:0, winHandleJiggle:0, winEngageTimer:0, winAnimHold:false, curtainLag:0,
  holoCoreLag:0, holoGlowLag:0,
  cityOffset:0,     // city scroll offset in pixels (wraps)
  spinA:0, spinV:0,
  draggingSpin:false, lastSX:0, lastSY:0,
  lampFlk:1,
  lastTs:0, camX:0, camY:0,
  neonPulse:1, siren:0, nextSiren:0, sirenHue:0, mood:'calm', holoMode:0, holoPulse:0,
  cityHolo:0, cityHoloPhase:'idle', nextCityHolo:999999, cityHoloMsg:0,
  camIX:0, camIY:0, camVX:0, camVY:0,
  helicopterT:-1, helicopterY:.22, helicopterActive:0, helicopterSpeed:.20, trainT:.55, lightning:0, nextLightning:0,
  rainGust:0, nextRainGust:0,
  timeOfDay:'auto', timeCycle:false, cycleStartedAt:0, cycleMinutesBase:22*60+47, timeBlend:{day:0,sunset:0,night:1}, weather:{rain:false,snow:false,mist:false,thunderstorm:false}, timePanel:false,
  emotionalNext:38, emotionalKind:null, emotionalA:0, emotionalHold:0, audioAnomaly:0,
  stormWind:0, thunderPulse:0, nextStormLightning:7,
  glowDirty:true, glowTick:0,
};

// ── CANVAS ─────────────────────────────────────────────
const cv=document.getElementById('c');
const cx=cv.getContext('2d');
cv.width=RW; cv.height=RH;
const glowCv=document.getElementById('glow');
const gcx=glowCv.getContext('2d');

// Low-resolution internal lightmaps.
// These are intentionally small and then scaled up, which gives a soft baked-game-lighting feel.
const LIGHTMAP_SCALE=.25;
const lmCv=document.createElement('canvas');
const smCv=document.createElement('canvas');
lmCv.width=smCv.width=Math.ceil(RW*LIGHTMAP_SCALE);
lmCv.height=smCv.height=Math.ceil(RH*LIGHTMAP_SCALE);
const lmx=lmCv.getContext('2d');
const smx=smCv.getContext('2d');

function resize(){
  const sx=innerWidth/RW, sy=innerHeight/RH;
  SCALE=Math.min(sx,sy);
  cv.style.width=(RW*SCALE)+'px';
  cv.style.height=(RH*SCALE)+'px';
  glowCv.width=innerWidth; glowCv.height=innerHeight; S.glowDirty=true;
}
addEventListener('resize',resize); resize();

const lerp=(a,b,t)=>a+(b-a)*t;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// ── REAL CLOCK SYNC + OFFSET OVERRIDES ────────────────
// The room now defaults to the user's real local time. Manual time changes
// move the world clock by an offset, then can glide back to real time.
let timeOffset=0;        // milliseconds offset from real local time
let timeSpeed=1;         // multiplier for dev/cycle time only
let timeAnchorReal=Date.now();
let timeAnchorWorld=timeAnchorReal;
let blendTimer=null;

function getWorldTimeMs(){
  return timeAnchorWorld + (Date.now()-timeAnchorReal)*timeSpeed;
}

function syncTimeAnchor(){
  const worldNow=getWorldTimeMs();
  timeAnchorReal=Date.now();
  timeAnchorWorld=worldNow;
  timeOffset=timeAnchorWorld-timeAnchorReal;
}

function getRealTime(){
  return new Date(getWorldTimeMs());
}

function setTimeSpeed(multiplier=1){
  syncTimeAnchor();
  timeSpeed=clamp(Number(multiplier)||1,1,240);
  const speed=document.getElementById('dev-speed');
  const label=document.getElementById('dev-speed-label');
  if(speed && Number(speed.value)!==timeSpeed) speed.value=String(timeSpeed);
  if(label) label.textContent=timeSpeed+'x';
}

function setManualTime(hours,minutes=0,preserveSpeed=true){
  clearInterval(blendTimer);
  blendTimer=null;
  if(!preserveSpeed) timeSpeed=1;

  const realNow=Date.now();
  const target=new Date(realNow);
  target.setHours(hours,minutes,0,0);

  timeAnchorReal=realNow;
  timeAnchorWorld=target.getTime();
  timeOffset=timeAnchorWorld-timeAnchorReal;
  S.timeCycle=false;
  S.timeOfDay='manual';

  updateLivingTime(.016,true);
  refreshClockDom();
  updateDevTimeReadout();
}

function clearManualTime(blendSeconds=20){
  const startWorld=getWorldTimeMs();
  const startReal=Date.now();
  const startOffset=startWorld-startReal;

  clearInterval(blendTimer);
  timeSpeed=1;
  blendTimer=setInterval(()=>{
    const elapsed=(Date.now()-startReal)/1000;
    const progress=clamp(elapsed/blendSeconds,0,1);
    const eased=smoothstep01(progress);
    const realNow=Date.now();

    timeOffset=startOffset*(1-eased);
    timeAnchorReal=realNow;
    timeAnchorWorld=realNow+timeOffset;

    S.timeCycle=false;
    updateLivingTime(.016,true);
    refreshClockDom();
    updateDevTimeReadout();

    if(progress>=1){
      clearInterval(blendTimer);
      blendTimer=null;
      timeOffset=0;
      timeAnchorReal=Date.now();
      timeAnchorWorld=timeAnchorReal;
      refreshClockDom();
      updateDevTimeReadout();
    }
  },100);
}

function refreshClockDom(){
  const mins=getWorldMinutes();
  const h=String(Math.floor(mins/60)).padStart(2,'0');
  const m=String(mins%60).padStart(2,'0');
  if(UI.clkTxt) UI.clkTxt.textContent=`${h}:${m}`;
}

function circularHourDistance(a,b){
  const d=Math.abs(a-b)%24;
  return Math.min(d,24-d);
}

function timeOfDayFactor(hour,peakHour,width=6){
  const diff=circularHourDistance(hour,peakHour);
  return Math.exp(-(diff*diff)/(2*width*width));
}

function timeWeightsFromMinutes(mins){
  const hour=(mins%1440)/60;
  const day=timeOfDayFactor(hour,13,4.6);
  const sunset=timeOfDayFactor(hour,18.7,1.35)*1.35;
  const night=Math.max(timeOfDayFactor(hour,23.5,4.2),timeOfDayFactor(hour,3.0,3.8))*.95;
  const total=Math.max(.0001,day+sunset+night);
  return {day:day/total,sunset:sunset/total,night:night/total};
}

function dominantTimeMode(weights=S.timeBlend){
  return Object.entries(weights).sort((a,b)=>b[1]-a[1])[0][0];
}

function updateTimeChipState(mode){
  document.querySelectorAll('[data-time]').forEach(el=>el.classList.toggle('on',el.dataset.time===mode));
}

function updateDevTimeReadout(){
  const input=document.getElementById('dev-time');
  const label=document.getElementById('dev-time-label');
  if(!input && !label) return;

  const mins=getWorldMinutes();
  const h=Math.floor(mins/60);
  const m=mins%60;
  const sliderValue=(h+m/60).toFixed(2);

  if(input && document.activeElement!==input) input.value=sliderValue;
  if(label) label.textContent=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}

function poissonOccurs(ratePerHour,dt){
  if(ratePerHour<=0 || dt<=0) return false;
  const ratePerSecond=ratePerHour/3600;
  return Math.random() < 1-Math.exp(-ratePerSecond*dt);
}

function timeWeightedRate(baseRatePerHour,peakHour,width=6,floor=.12){
  const hour=getWorldMinutes()/60;
  return baseRatePerHour*(floor+timeOfDayFactor(hour,peakHour,width));
}

function triggerSiren(){
  if(S.siren>0) return;
  S.siren=1;
  S.sirenHue=Math.random()>.5?0:1;
  S.glowDirty=true;
}

function triggerHelicopter(){
  if(S.helicopterActive>0) return;
  S.helicopterActive=1;
  S.helicopterT=0;
  S.helicopterY=.14+Math.random()*.14;
}

function triggerLightning(){
  if(S.lightning>0) return;
  const storm=!!S.weather?.thunderstorm;
  S.lightning=1;
  S.glowDirty=true;
  S.thunderPulse=storm ? .85 : .20;
}

function triggerRainGust(){
  if(S.rainGust>0) return;
  S.rainGust=1;
}

function updatePoissonEvents(dt){
  // These are Poisson processes: every frame has a probability based on an
  // hourly rate, so intervals feel natural rather than fixed.
  const storm=!!S.weather?.thunderstorm;
  const raining=!!(S.weather?.rain || storm);
  const hour=getWorldMinutes()/60;

  const sirenRate=timeWeightedRate(2.8,14,5.5,.16);
  const helicopterRate=timeWeightedRate(1.8,13,4.8,.03);
  const lightningRate=storm ? timeWeightedRate(14,16,3.8,.35) : timeWeightedRate(.18,18,3.5,0);
  const rainGustRate=raining ? timeWeightedRate(storm?18:6,15,4.4,.20) : 0;

  if(poissonOccurs(sirenRate,dt)) triggerSiren();
  if(poissonOccurs(helicopterRate,dt)) triggerHelicopter();
  if(poissonOccurs(lightningRate,dt)) triggerLightning();
  if(poissonOccurs(rainGustRate,dt)) triggerRainGust();
}

// ── HUSH OS v0.35 ASSET-FIRST BACKGROUND ───────────────────
// The room shell is now an external image asset. Dynamic systems such as the
// window, weather, lamp, radio, TV and holocube are still rendered live.
const ROOM_BASE_SRC='assets/room-base.png';
const roomBaseImg=new Image();
roomBaseImg.src=ROOM_BASE_SRC;
function drawAssetRoomBase(){
  if(roomBaseImg && roomBaseImg.complete && roomBaseImg.naturalWidth){
    cx.drawImage(roomBaseImg,0,0,RW,RH);
    return;
  }

  // Minimal fallback only. The old procedural sofa/plant/furniture renderer
  // has been removed now the illustrated room base is canonical.
  const g=cx.createLinearGradient(0,0,0,RH);
  g.addColorStop(0,'#12091e');
  g.addColorStop(.55,'#10071a');
  g.addColorStop(1,'#050309');
  cx.fillStyle=g;
  cx.fillRect(0,0,RW,RH);
}


// ── HUSH OS v0.35 PERFORMANCE / STRUCTURE CONFIG ───────────────
// Keep behaviour tuning in one place so the prototype is easier to hand to another developer.
const CONFIG={
  perf:{
    clockUpdateInterval:.25,      // DOM clock text updates 4 times/sec, not every frame
    audioUpdateInterval:.10,      // spatial audio mixer updates 10 times/sec
    glowEveryNFrames:2,           // full-res bloom layer updates every other frame
    hiddenFrameInterval:500       // when tab is hidden, throttle animation work hard
  }
};

// Frequently touched DOM refs are cached after DOMContentLoaded.
const UI={};
function cacheUiRefs(){
  ['init','cur','label','back','clock','clkTxt','timeTxt','timeUi','focusUi','radioUi','tvUi','winUi','holoUi','rPow','rVol','tPow','winTog','winLean'].forEach(id=>{
    UI[id]=document.getElementById(id);
  });
}

function rr(ctx,x,y,w,h,r,fill,stroke){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
  if(fill)ctx.fill();if(stroke)ctx.stroke();
}

// ── ROOM LAYOUT ────────────────────────────────────────
const W=RW, H=RH;
// Window: large panoramic, centred, takes most of wall
// v0.35: window co-ordinates aligned to the illustrated room base.
const WIN={x:140,y:48,w:354,h:172};
// Vanishing point for 2.5D perspective
const VP={x:W/2, y:WIN.y+WIN.h+8}; // VP at window sill level

const R={
  win:   WIN,
  lamp:  {x:72,y:224},
  radio: {x:144,y:222,w:116,h:42},
  tv:    {x:500,y:208,w:98,h:78},
  holo:{x:320,y:306,w:44,h:38},
  floorY:230,
};

// Hotspots
const HOTSPOTS=[
  // Clock is first by design. If future art changes put it near another hotspot,
  // it still wins the hit-test and remains the only time controller.
  {id:'clock',  label:'the clock', col:'rgba(141,224,255,.7)',
   x:R.tv.x+10, y:R.tv.y-24, w:62, h:24,
   zoom:{s:2.35, x:.78, y:.48}},
  {id:'window', label:'the window', col:'rgba(159,226,255,.7)',
   x:R.win.x, y:R.win.y, w:R.win.w, h:R.win.h,
   zoom:{s:1.72, x:.47, y:.34}},
  {id:'tv',     label:'the television', col:'rgba(180,242,255,.7)',
   x:R.tv.x,  y:R.tv.y,  w:R.tv.w,  h:R.tv.h,
   zoom:{s:2.4, x:.80, y:.65}},
  {id:'radio',  label:'the radio', col:'rgba(255,216,255,.7)',
   x:R.radio.x,y:R.radio.y,w:R.radio.w,h:R.radio.h,
   zoom:{s:2.2, x:.24, y:.58}},
  {id:'lamp',   label:'the lamp',  col:'rgba(255,212,154,.7)',
   x:R.lamp.x-70,y:R.lamp.y-95,w:140,h:115,
   zoom:{s:2.0, x:.33, y:.54}},
  {id:'holo',   label:'the cube', col:'rgba(200,184,255,.7)',
   x:R.holo.x-28,y:R.holo.y-35,w:56,h:64,
   zoom:{s:2.25, x:.48, y:.84}},
];

// ── CITY BUILDINGS ─────────────────────────────────────
// Buildings stored at PIXEL positions within a virtual city strip
// City strip is CITY_W pixels wide; we wrap offset to tile seamlessly
const CITY_W = W * 3; // wide enough to wrap smoothly

function mkBuilding(x, layerIdx){
  const depths   = [0.015, 0.045, 0.09, 0.18];
  const shades   = ['#0c0818','#110c1e','#160e26','#1c1230'];
  const heights  = [[18,50],[28,80],[38,110],[50,140]];
  const [hmin,hmax]=heights[layerIdx];
  const h=hmin+Math.floor(Math.random()*(hmax-hmin));
  const w=Math.floor((h*.3)+Math.random()*(h*.5)+8);
  return {
    x, w, h,
    shade: shades[layerIdx],
    depth: depths[layerIdx],
    wins: Array.from({length:Math.floor(w*h/300)+2},()=>({
      ox: 4+Math.random()*(w-12), oy: 6+Math.random()*(h-12),
      on: Math.random()>.42,
      rate: 4000+Math.random()*56000, last:Math.random()*60000, alwaysOn: Math.random()<.18,
      warm: Math.random()>.45,
    })),
    sign: layerIdx>=2 && Math.random()>.78,
    signCol: ['#e040fb','#00e5ff','#ff4081','#ffab40'][Math.floor(Math.random()*4)],
    signText: ['HUSH','NITE','雨','NOCT','空き'][Math.floor(Math.random()*5)],
    screen: layerIdx>=2 && Math.random()>.65,
    screenPh: Math.random()*Math.PI*2,
  };
}

// Build 4 parallax layers with buildings spanning CITY_W
const cityLayers=Array.from({length:4},(_,li)=>{
  const spacing=[12,18,28,45][li];
  const buildings=[];
  for(let x=0;x<CITY_W;x+=spacing+Math.floor(Math.random()*spacing*.5)){
    buildings.push(mkBuilding(x,li));
  }
  return {buildings, depth:[0.015,0.045,0.09,0.18][li]};
});

// ── DISTANT LIFE SYSTEM ───────────────────────────────
// Evidence of people, not visible street-level people.
// Designed for high-rise / penthouse altitude.
const distantLife = Array.from({length:34},()=>({
  layer: 2 + Math.floor(Math.random()*2), // only mid/far towers
  x: Math.random(),
  y: .18 + Math.random()*.45,
  w: 10 + Math.random()*18,
  h: 8 + Math.random()*18,
  phase: Math.random()*Math.PI*2,
  type: ['curtain','tv','silhouette','floor','beacon'][Math.floor(Math.random()*5)],
  next: 2 + Math.random()*18,
  active: 0,
  dur: 2 + Math.random()*7,
  seed: Math.random()*999
}));

// Rain particles — stored as fractions 0..1 of window
const rainFar=Array.from({length:80},()=>({x:Math.random(),y:Math.random(),len:6+Math.random()*14,spd:.4+Math.random()*.8,a:.08+Math.random()*.14}));
const rainGlass=Array.from({length:40},()=>({x:Math.random(),y:Math.random()-.2,len:20+Math.random()*40,spd:.2+Math.random()*.5,a:.12+Math.random()*.22}));
const snowFlakes=Array.from({length:95},()=>({x:Math.random(),y:Math.random(),r:.55+Math.random()*1.6,spd:.10+Math.random()*.36,drift:Math.random()*6.28,a:.16+Math.random()*.34}));

// ── STARS ─────────────────────────────────────────────
// Generated once, rendered per-frame against sky blend
const stars=Array.from({length:180},()=>({
  x:Math.random(), y:Math.random()*.68,
  r:.35+Math.random()*.85,
  a:.25+Math.random()*.55,
  twinkle:Math.random()*Math.PI*2,
  twinkleRate:.4+Math.random()*1.1,
}));

// ── MOON ──────────────────────────────────────────────
// Crescent moon, fixed position in upper-right sky quadrant
const MOON={px:.78, py:.14, r:10};

// ── CLOUDS ────────────────────────────────────────────
// Slow-drifting cloud puffs, visible at day/sunset only
const clouds=Array.from({length:6},(_,i)=>({
  x: .08 + i*.16 + Math.random()*.1,
  y: .08 + Math.random()*.28,
  speed: .0004 + Math.random()*.0004,
  scale: .55 + Math.random()*.7,
  alpha: .12 + Math.random()*.18,
  // Each cloud is a cluster of overlapping ellipses
  puffs: Array.from({length:4+Math.floor(Math.random()*3)},(_,j)=>({
    ox:j*14-20+Math.random()*10,
    oy:Math.random()*6-3,
    rx:18+Math.random()*14,
    ry:9+Math.random()*7,
  })),
}));

// ── GLASS DROPLETS ────────────────────────────────────
// Droplets that slide down the window glass when raining
const glassDroplets=Array.from({length:28},()=>({
  x:Math.random(),        // 0..1 within window
  y:Math.random()*1.2-.1, // start anywhere
  spd:.018+Math.random()*.055,
  r:1.4+Math.random()*2.2,
  wobble:Math.random()*Math.PI*2,
  trail:2+Math.floor(Math.random()*4),
  a:.25+Math.random()*.4,
}));

// ── WALL NOISE TEXTURE ────────────────────────────────
// Baked once into an offscreen canvas, tiled on the wall.
// Using multiplicative noise keeps it from fighting the lighting.
const wallNoiseCv=(()=>{
  const nc=document.createElement('canvas');
  nc.width=128; nc.height=128;
  const nx=nc.getContext('2d');
  const id=nx.createImageData(128,128);
  const d=id.data;
  for(let i=0;i<d.length;i+=4){
    const v=Math.random();
    d[i]=d[i+1]=d[i+2]=v<.015?255:v<.04?180:128;
    d[i+3]=v<.015?14:v<.04?6:3;
  }
  nx.putImageData(id,0,0);
  return nc;
})();

// Traffic streaks
const traffic=Array.from({length:14},()=>({
  x:Math.random(), spd:.18+Math.random()*.55,
  col:Math.random()>.5?'rgba(255,200,80,.85)':'rgba(255,80,100,.75)',
  tail:6+Math.floor(Math.random()*20),
  lane:Math.floor(Math.random()*2), // 0=near,1=far
  dir:Math.random()>.5?1:-1,
}));

// Lean-out city mode: wider virtual skyline that fills the whole screen when you lean out.
// This is still 2.5D canvas, but it behaves like a separate outside camera rather than a deeper room zoom.
const leanCityLayers=Array.from({length:6},(_,li)=>{
  const count=[22,18,15,12,9,7][li];
  return Array.from({length:count},(_,i)=>({
    x:i/count + Math.random()/count*.55,
    w:.018+Math.random()*.035 + li*.004,
    h:.16+Math.random()*.34 + li*.035,
    y:.78-li*.018,
    col:['#05030b','#070412','#0a0618','#100820','#160b28','#1d0d30'][li],
    neon:['#00e5ff','#ff40b8','#c080ff','#ffab40','#70f0ff'][Math.floor(Math.random()*5)],
    sign:Math.random()>.63,
    ph:Math.random()*Math.PI*2,
    antenna:Math.random()>.72,
  }));
});
const leanTraffic=Array.from({length:28},()=>({
  x:Math.random(), y:.73+Math.random()*.20, spd:.05+Math.random()*.16,
  dir:Math.random()>.5?1:-1, tail:8+Math.random()*22,
  col:Math.random()>.5?'rgba(255,210,120,.85)':'rgba(80,220,255,.75)'
}));

// Dust motes near lamp
const dust=Array.from({length:20},()=>({x:R.lamp.x+(Math.random()-.5)*90,y:R.lamp.y+(Math.random()-.5)*70,vx:(Math.random()-.5)*.12,vy:-.04-Math.random()*.08,a:.0+Math.random()*.55,ph:Math.random()*Math.PI*2}));

// ── AUDIO ──────────────────────────────────────────────
let AC,Gains={};
function stGain(){return [.22,.30,.13][S.radioSt]}
function initAudio(){
  if(AC)return;
  AC=new(window.AudioContext||window.webkitAudioContext)();
  const M=AC.createGain();M.gain.value=.44;M.connect(AC.destination);
  function mkNoise(n,ft,ff,Q,iv){
    const buf=AC.createBuffer(1,AC.sampleRate*4,AC.sampleRate);
    const d=buf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
    const src=AC.createBufferSource();src.buffer=buf;src.loop=true;
    const f=AC.createBiquadFilter();f.type=ft;f.frequency.value=ff;f.Q.value=Q;
    const g=AC.createGain();g.gain.value=iv;
    src.connect(f);f.connect(g);g.connect(M);src.start();
    Gains[n]=g;
  }
  function mkTone(n,freq,type,iv){
    const o=AC.createOscillator();
    const f=AC.createBiquadFilter();f.type='lowpass';f.frequency.value=300;
    const g=AC.createGain();g.gain.value=iv;
    o.type=type;o.frequency.value=freq;o.connect(f);f.connect(g);g.connect(M);o.start();
    Gains[n]=g;
  }
  function mkRadio(){
    const g=AC.createGain();g.gain.value=0;
    const c=AC.createDynamicsCompressor();g.connect(c);c.connect(M);
    [[130.81,0],[164.81,.07],[196,.04],[246.94,.11]].forEach(([f2,d])=>{
      const o=AC.createOscillator(),og=AC.createGain();
      const lfo=AC.createOscillator(),lg=AC.createGain();
      o.type='triangle';o.frequency.value=f2;og.gain.value=.052;
      lfo.frequency.value=.2+d;lg.gain.value=1.1;
      lfo.connect(lg);lg.connect(o.frequency);o.connect(og);og.connect(g);
      lfo.start();o.start(AC.currentTime+d);
    });
    Gains.radio=g;
  }
  mkNoise('rain','bandpass',700,1.8,.12);
  mkNoise('city','lowpass',90,1,.042);
  mkNoise('static','bandpass',2300,2.2,0);
  mkNoise('tv','bandpass',920,1.6,0);
  mkNoise('wind','bandpass',170,0.9,0);
  mkNoise('thunder','lowpass',85,0.7,0);
  mkNoise('anomaly','bandpass',1550,7.5,0);
  mkTone('room',50,'sine',.014);
  // TV hum removed. Audio is radio + rain only.
  // No TV hum. Sound comes only from the radio, rain, and faint outside traffic when the window is open.
  mkRadio();
  if(S.radioOn)ramp('radio',S.radioVol*stGain(),1.2);
  S.audioReady=true;
}
function ramp(n,v,d){if(!Gains[n]||!AC)return;Gains[n].gain.linearRampToValueAtTime(v,AC.currentTime+d)}
function moodSettings(){
  return {
    calm:{rain:.10, city:.006, neon:1.0, room:.014},
    rain:{rain:.19, city:.012, neon:.82, room:.012},
    neon:{rain:.08, city:.014, neon:1.45, room:.013},
    midnight:{rain:.07, city:.004, neon:.58, room:.009},
  }[S.mood] || {rain:.10, city:.006, neon:1, room:.014};
}
function updateAmbience(d=.6){
  if(!S.audioReady) return;
  const m=moodSettings();

  // v0.35 spatial audio mix. Sound now behaves like it belongs in the room.
  const focus=S.focus||'room';
  const lookingWindow=focus==='window';
  const leaning=lookingWindow && S.windowLean;

  let rain=0;
  let city=m.city;

  if(S.weather && (S.weather.rain || S.weather.thunderstorm)){
    rain=m.rain + (S.weather.thunderstorm ? .10 : 0);
    if(S.winOpen) rain+=.12;
    if(lookingWindow) rain+=.08;
    if(leaning) rain+=.06;
  } else {
    if(S.winOpen) city+=.025;
  }

  if(lookingWindow) city+=.025;
  if(leaning) city+=.045;

  // Radio lives physically on the left console. It comes forward when focused,
  // recedes when watching the TV or leaning out of the window.
  let radioMul=.86;
  if(focus==='radio') radioMul=1.28;
  if(focus==='tv') radioMul=.48;
  if(lookingWindow) radioMul=leaning?.36:.58;
  if(!S.radioOn) radioMul=0;

  // TV is only really audible when you are watching it.
  const tvLevel=(S.tvOn && focus==='tv') ? (.010 + .010*clamp(S.tvBloom||0,0,1)) : 0;

  const windLevel = S.weather.thunderstorm ? (.030 + .030*clamp(S.stormWind||0,0,1) + (S.winOpen?.035:0) + (leaning?.035:0)) : 0;
  const thunderLevel = (S.weather.thunderstorm && S.thunderPulse>0) ? (.12*S.thunderPulse) : 0;
  const anomalyLevel = S.audioAnomaly>0 ? (.018*S.audioAnomaly) : 0;

  ramp('wind',windLevel,d);
  ramp('thunder',thunderLevel,Math.min(.22,d));
  ramp('anomaly',anomalyLevel,Math.min(.18,d));
  ramp('rain',rain,d);
  ramp('city',city,d);
  ramp('room',m.room,d);
  ramp('radio',S.radioVol*stGain()*radioMul,d);
  ramp('tv',tvLevel,d);

  const staticLevel=(S.radioOn && focus==='radio') ? S.radioStatic*.055*S.radioVol : 0;
  ramp('static',staticLevel,Math.min(.18,d));
}

function tuneRadioTo(v, immediate=false){
  S.radioTuneTarget=clamp(v,0,2);
  if(immediate) S.radioTune=S.radioTuneTarget;
  const nearest=Math.round(S.radioTuneTarget);
  if(nearest!==S.radioSt){
    S.radioSt=nearest;
    document.querySelectorAll('[data-st]').forEach(n=>n.classList.toggle('on',+n.dataset.st===S.radioSt));
  }
  S.radioStatic=Math.max(S.radioStatic,.55);
  S.radioDeskKick=Math.max(S.radioDeskKick,.42);
  if(S.radioClickCooldown<=0){playMicroClick(immediate?'soft':'hard');S.radioClickCooldown=.075;}
  if(S.audioReady&&S.radioOn)ramp('radio',S.radioVol*stGain(),.22);
}

function cycleTVChannel(){
  S.tvCh=(S.tvCh+1)%4;
  S.tvFlicker=.42;
  S.tvBloom=.38;
  document.querySelectorAll('[data-ch]').forEach(n=>n.classList.toggle('on',+n.dataset.ch===S.tvCh));
  syncAnimeVideo();
}

function setTVPower(on){
  S.tvPowerPending=on;
  S.tvPowerTimer=.11;
  S.tvFlicker=.28;
  S.tvBloom=.18;
  S.tvHumPulse=.22;
  playMicroClick('hard');
  syncAnimeVideo();
}


function playMicroClick(kind='soft'){
  if(!S.audioReady || !AC) return;
  const now=AC.currentTime;
  const g=AC.createGain();
  g.gain.setValueAtTime(0.0001,now);
  g.gain.exponentialRampToValueAtTime(kind==='hard'?0.035:0.018,now+0.006);
  g.gain.exponentialRampToValueAtTime(0.0001,now+(kind==='hard'?.09:.055));
  const o=AC.createOscillator();
  o.type=kind==='hard'?'square':'triangle';
  o.frequency.setValueAtTime(kind==='hard'?160:520,now);
  o.frequency.exponentialRampToValueAtTime(kind==='hard'?70:260,now+(kind==='hard'?.08:.05));
  o.connect(g);g.connect(AC.destination);
  o.start(now);o.stop(now+(kind==='hard'?.10:.065));
}
function playAirShift(){
  if(!S.audioReady || !AC) return;
  const now=AC.currentTime;
  const dur=.55;
  const buf=AC.createBuffer(1,AC.sampleRate*dur,AC.sampleRate);
  const d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(1-i/d.length);
  const src=AC.createBufferSource();src.buffer=buf;
  const f=AC.createBiquadFilter();f.type='bandpass';f.frequency.value=520;f.Q.value=.7;
  const g=AC.createGain();g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(.026,now+.05);g.gain.exponentialRampToValueAtTime(.0001,now+dur);
  src.connect(f);f.connect(g);g.connect(AC.destination);src.start(now);src.stop(now+dur);
}
function playTvBloomSound(){
  if(!S.audioReady || !AC) return;
  const now=AC.currentTime;
  const o=AC.createOscillator();o.type='sine';
  const g=AC.createGain();g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(.018,now+.04);g.gain.exponentialRampToValueAtTime(.0001,now+.32);
  o.frequency.setValueAtTime(46,now);o.frequency.exponentialRampToValueAtTime(92,now+.25);
  o.connect(g);g.connect(AC.destination);o.start(now);o.stop(now+.34);
}
function updatePhysicalControls(dt){
  // Radio tuning now has mass: spring, overshoot and settling rather than direct interpolation.
  const before=S.radioTune;
  const stiffness=S.radioDrag?105:58;
  const damping=S.radioDrag?17:11.5;
  S.radioKnobVel += (S.radioTuneTarget-S.radioTune)*stiffness*dt;
  S.radioKnobVel *= Math.exp(-damping*dt);
  S.radioTune += S.radioKnobVel*dt;
  S.radioTune=clamp(S.radioTune,-.08,2.08);

  const tuneMotion=Math.abs(S.radioTune-before)*22;
  const stationDistance=Math.abs(S.radioTune-Math.round(S.radioTune));
  const betweenStations=clamp(stationDistance/.5,0,1);
  S.radioStatic=lerp(S.radioStatic,betweenStations*.75 + tuneMotion*.20,Math.min(1,dt*5));
  S.radioDeskKick=Math.max(0,S.radioDeskKick-dt*5.2);
  S.radioClickCooldown=Math.max(0,S.radioClickCooldown-dt);

  if(S.audioReady && Gains.static){
    const staticLevel=(S.radioOn && S.focus==='radio') ? S.radioStatic*.055*S.radioVol : 0;
    ramp('static',staticLevel,.08);
  }

  // TV power has a tiny physical delay before it actually catches.
  if(S.tvPowerPending!==null){
    S.tvPowerTimer-=dt;
    if(S.tvPowerTimer<=0){
      S.tvOn=S.tvPowerPending; S.glowDirty=true;
      S.tvPowerPending=null;
      S.tvFlicker=S.tvOn?1.15:.75;
      S.tvBloom=S.tvOn?.85:.25;
      S.tvHumPulse=S.tvOn?1:.35;
      document.getElementById('tPow')?.classList.toggle('on',S.tvOn);
      playTvBloomSound();
    }
  }
  S.tvFlicker=Math.max(0,S.tvFlicker-dt*1.65);
  S.tvBloom=Math.max(0,S.tvBloom-dt*1.25);
  S.tvHumPulse=Math.max(0,S.tvHumPulse-dt*1.8);

  // Window has a short latch/engage moment before the frame visibly moves.
  S.winEngageTimer=Math.max(0,S.winEngageTimer-dt);
  S.winAirPulse=Math.max(0,S.winAirPulse-dt*1.35);
  S.winHandleJiggle=Math.max(0,S.winHandleJiggle-dt*2.6);
  S.curtainLag += (S.winAnim-S.curtainLag)*Math.min(1,dt*3.1);

  // Hologram core and glow no longer move in perfect lockstep.
  const holoTarget=.5+.5*Math.sin(S.t*1.4);
  S.holoCoreLag += (holoTarget-S.holoCoreLag)*Math.min(1,dt*5.5);
  S.holoGlowLag += (S.holoCoreLag-S.holoGlowLag)*Math.min(1,dt*1.65);
}

function setMood(m){
  S.mood=m; S.glowDirty=true;
  document.querySelectorAll('[data-mood]').forEach(el=>el.classList.toggle('on',el.dataset.mood===m));
  const mt=document.getElementById('moodTxt'); if(mt) mt.textContent=m.toUpperCase();
  updateAmbience(.7);
}

// ── FOCUS ──────────────────────────────────────────────
function focusCameraFor(id){
  // Object-centred focus camera.
  // Important: CSS is still `scale(s) translate(tx, ty)`, so tx/ty are calculated
  // in the canvas coordinate space before scaling. This keeps the clicked object
  // genuinely centred rather than using rough percentage anchors.
  const targets={
    window:{x:R.win.x, y:R.win.y, w:R.win.w, h:R.win.h, s:S.windowLean?1.28:1.82, aimX:.50, aimY:S.windowLean?.50:.47},
    tv:{x:R.tv.x-6, y:R.tv.y-24, w:R.tv.w+12, h:R.tv.h+34, s:2.85, aimX:.50, aimY:.49},
    radio:{x:R.radio.x-10, y:R.radio.y-10, w:R.radio.w+20, h:R.radio.h+22, s:2.65, aimX:.50, aimY:.48},
    holo:{x:R.holo.x-42, y:R.holo.y-56, w:84, h:88, s:2.75, aimX:.50, aimY:.48},
  };
  return targets[id] || null;
}

function applyFocusZoom(id){
  const target=focusCameraFor(id);
  if(!target) return;

  // v0.35 camera fix: calculate the zoom in actual CSS pixels, not raw canvas pixels.
  // This keeps the focused object centred correctly in full screen and on any aspect ratio.
  const objectCx=target.x+target.w/2;
  const objectCy=target.y+target.h/2;
  const baseW=RW*SCALE, baseH=RH*SCALE;
  const baseLeft=(innerWidth-baseW)/2;
  const baseTop=(innerHeight-baseH)/2;
  const desiredX=innerWidth*target.aimX;
  const desiredY=innerHeight*target.aimY;
  const tx=desiredX-baseLeft-(objectCx*SCALE*target.s);
  const ty=desiredY-baseTop-(objectCy*SCALE*target.s);

  cv.style.transformOrigin='0 0';
  cv.style.transform=`translate(${tx}px,${ty}px) scale(${target.s})`;
  cv.style.filter=id==='window'
    ? 'brightness(1.065) contrast(1.03) drop-shadow(0 0 30px rgba(120,190,255,.20))'
    : 'brightness(1.035) contrast(1.025) drop-shadow(0 0 26px rgba(190,150,255,.15))';
}
function setFocus(id){
  // v0.35: time controls are clock-only. Any normal focus closes them.
  if(id!=='clock') closeTimeController();
  S.focus=id;
  document.querySelectorAll('.fcard').forEach(c=>c.classList.add('hidden'));
  const fui=document.getElementById('focusUi');
  const bk=document.getElementById('back');
  if(!id){
    cv.style.transformOrigin='0 0';
    cv.style.transform='translate(0px,0px) scale(1)';
    cv.style.filter='none';
    fui.classList.remove('show');
    bk.classList.remove('show');
    document.getElementById('label').classList.remove('show');
    if(S.audioReady)updateAmbience(.8)
    return;
  }
  applyFocusZoom(id);
  bk.classList.add('show');
  fui.classList.add('show');
  const uiMap={radio:'radioUi',tv:'tvUi',window:'winUi',holo:'holoUi'};
  const uid=uiMap[id];
  if(uid) setTimeout(()=>document.getElementById(uid).classList.remove('hidden'),500);
  if(id==='tv'){const lbl=document.getElementById('label');lbl.textContent='[ CLICK TV TO CHANGE CHANNEL ]';lbl.style.color='#b4f2ff';lbl.classList.add('show');}
  if(id==='radio'){const lbl=document.getElementById('label');lbl.textContent='[ CLICK RADIO TO CHANGE STATION ]';lbl.style.color='#ffd8ff';lbl.classList.add('show');}
  if(S.audioReady)updateAmbience(1)
}

function hitTest(cx2,cy2){
  const r=cv.getBoundingClientRect();
  const x=(cx2-r.left)/SCALE, y=(cy2-r.top)/SCALE;
  return HOTSPOTS.find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h)||null;
}

function render(ts){
  if(document.hidden && S.hiddenLast && ts-S.hiddenLast<CONFIG.perf.hiddenFrameInterval){
    requestAnimationFrame(render);
    return;
  }
  S.hiddenLast=ts;

  const dt=S.lastTs?Math.min(0.05,(ts-S.lastTs)/1000):0.016;
  S.lastTs=ts;
  S.t=ts/1000;
  S.frame++;

  // Clock + living time. Defaults to real local time, unless an offset override is active.
  updateLivingTime(dt);
  S.clockAccum+=dt;
  if(S.clockAccum>=CONFIG.perf.clockUpdateInterval){
    S.clockAccum=0;
    refreshClockDom();
    updateDevTimeReadout();
  }

  // Physical camera: subtle inertia, idle breathing drift and tiny mouse-led parallax.
  // The city remains spatially locked; only the viewer's head/camera has weight.
  S.plx=0;
  const mouseX=clamp(S.mx||0,-1,1);
  const mouseY=clamp(S.my||0,-1,1);
  const leanWeight=clamp(S.leanAnim||0,0,1);
  const focusWeight=S.focus?0.72:0.28;
  const targetCamX=(Math.sin(S.t*.21)*0.72 + Math.sin(S.t*.047)*0.36) + mouseX*focusWeight*(1+leanWeight*.6);
  const targetCamY=(Math.cos(S.t*.18)*0.45 + Math.sin(S.t*.033)*0.22) + mouseY*focusWeight*.48 + leanWeight*mouseY*1.25;
  S.camVX += (targetCamX-S.camIX)*0.038;
  S.camVY += (targetCamY-S.camIY)*0.038;
  S.camVX *= .84;
  S.camVY *= .84;
  S.camIX += S.camVX;
  S.camIY += S.camVY;
  S.camX=S.camIX;
  S.camY=S.camIY;

  // City buildings are static. Only rain, traffic, signs, water and lights move.
  S.cityOffset=0;

  // Smooth mechanical window open/close animation. 0 = shut, 1 = open.
  const winTarget=(S.winEngageTimer>0?S.winAnimHold:S.winOpen)?1:0;
  S.winAnim += (winTarget-S.winAnim) * Math.min(1, dt*5.2);
  const leanTarget=(S.focus==='window' && S.windowLean)?1:0;
  S.leanAnim += (leanTarget-S.leanAnim) * Math.min(1, dt*3.8);

  // Living-light system: slow neon pulse + Poisson-distributed ambient events.
  updatePoissonEvents(dt);
  S.neonPulse=(.86+Math.sin(S.t*.55)*.09+Math.sin(S.t*1.17)*.045)*moodSettings().neon*timeProfile().neon;
  if(S.lampOn || S.siren>0 || S.lightning>0 || S.thunderPulse>0 || S.emotionalKind) S.glowDirty=true;
  if(S.siren>0) S.siren=Math.max(0,S.siren-dt*.42);
  updateCinematicEvents(dt);
  updatePhysicalControls(dt);
  updateEmotionalLayer(dt);
  S.audioAccum+=dt;
  if(S.audioAccum>=CONFIG.perf.audioUpdateInterval){
    S.audioAccum=0;
    updateAmbience(.18);
  }
  updateDistantLife(dt);

  // Lamp flicker
  S.lampFlk=.9+Math.sin(S.t*13.7)*.06+Math.sin(S.t*7.3)*.04;

  // Holocube idle motion
  S.spinA+=0.012; S.spinV*=.988;

  cx.clearRect(0,0,RW,RH);
  cx.save();
  cx.translate(S.camX,S.camY);

  drawAssetRoomBase();
  drawWindowView();
  drawTimeOfDayWindowGrade();
  drawWindowLifeEvents();
  drawRainLayering();
  drawSnowLayering();
  drawWindowInteriorReflections();
  drawNeonSpillOnWalls();
  drawWindowLightSpill();
  drawCinematicFloorReflections();
  drawLamp();
  drawRadio();
  drawTV();
  drawHoloCube();
  drawDynamicLightPass();
  drawReactiveLightingPass();
  drawV16LightmapPass();
  drawTimeOfDayRoomLight();
  drawWeatherAtmosphere();
  drawEmotionalLayer();
  drawFocusAtmosphere();
  drawDust();
  drawLeanOutCityOverlay();
  drawLeanOutLifeEvents();
  drawLeanOutSnow();
  drawFocusHighlight();
  cx.restore();

  S.glowTick=(S.glowTick||0)+1;
  if(S.glowDirty || S.glowTick>=CONFIG.perf.glowEveryNFrames){
    S.glowTick=0;
    if(S.glowDirty) drawGlowCanvas();
  }

  requestAnimationFrame(render);
}

// ── BASE ROOM ──────────────────────────────────────────

function updateDistantLife(dt){
  distantLife.forEach(l=>{
    l.next-=dt;
    if(l.next<=0 && l.active<=0){
      l.active=1;
      l.dur=1.6+Math.random()*7.5;
      l.next=8+Math.random()*38;
    }
    if(l.active>0){
      l.dur-=dt;
      if(l.dur<=0) l.active=0;
    }
  });
}

function drawDistantLife(x,y,w,h){
  cx.save(); cx.beginPath(); cx.rect(x,y,w,h); cx.clip();
  distantLife.forEach(l=>{
    if(l.active<=0) return;
    const px=x+l.x*w, py=y+l.y*h;
    const pulse=.55+Math.sin(S.t*2.1+l.phase)*.25;
    const flicker=Math.random()<.035?.2:1;
    const alpha=clamp((.28+pulse*.28)*flicker,0,.7);

    if(l.type!=='beacon'){
      const g=cx.createRadialGradient(px+l.w/2,py+l.h/2,0,px+l.w/2,py+l.h/2,34);
      g.addColorStop(0,`rgba(255,185,130,${alpha*.05})`);
      g.addColorStop(1,'transparent');
      cx.fillStyle=g;
      cx.fillRect(px-28,py-24,l.w+56,l.h+48);
    }

    if(l.type==='curtain'){
      cx.fillStyle=`rgba(255,190,130,${alpha*.42})`;
      rr(cx,px,py,l.w,l.h,1.5,true,false);
      cx.fillStyle=`rgba(20,8,28,${alpha*.45})`;
      cx.fillRect(px+l.w*.47,py,1,l.h);
      cx.fillStyle=`rgba(255,230,180,${alpha*.22})`;
      cx.fillRect(px+2,py+2,l.w-4,1);
    }

    if(l.type==='tv'){
      const tvGlow=.4+Math.sin(S.t*8.5+l.seed)*.22+Math.sin(S.t*17.1)*.08;
      cx.fillStyle=`rgba(120,210,255,${clamp(tvGlow,.1,.75)})`;
      rr(cx,px,py,l.w,l.h*.62,1.5,true,false);
      cx.fillStyle=`rgba(255,80,190,${alpha*.28})`;
      cx.fillRect(px+2,py+l.h*.32,l.w-4,1);
    }

    if(l.type==='silhouette'){
      cx.fillStyle=`rgba(255,210,150,${alpha*.28})`;
      rr(cx,px,py,l.w,l.h,1.5,true,false);
      const sx=px+l.w*(.38+Math.sin(S.t*.7+l.seed)*.12);
      const sy=py+l.h*.22;
      cx.fillStyle=`rgba(4,2,8,${alpha*.82})`;
      cx.beginPath();
      cx.arc(sx,sy+2,2.1,0,Math.PI*2);
      cx.fill();
      cx.fillRect(sx-1.5,sy+4,3,l.h*.46);
    }

    if(l.type==='floor'){
      const bandH=3+Math.sin(S.t*.8+l.seed)*.8;
      cx.fillStyle=`rgba(255,180,95,${alpha*.24})`;
      cx.fillRect(px-l.w*1.6,py,l.w*3.8,bandH);
      cx.fillStyle=`rgba(120,220,255,${alpha*.12})`;
      cx.fillRect(px-l.w*1.3,py+bandH+2,l.w*2.5,1);
    }

    if(l.type==='beacon'){
      const blink=Math.sin(S.t*4.2+l.seed)>.68?1:.18;
      cx.fillStyle=`rgba(255,70,120,${alpha*blink})`;
      cx.beginPath();
      cx.arc(px,py,1.8,0,Math.PI*2);
      cx.fill();
      const bg=cx.createRadialGradient(px,py,0,px,py,26);
      bg.addColorStop(0,`rgba(255,70,120,${alpha*blink*.14})`);
      bg.addColorStop(1,'transparent');
      cx.fillStyle=bg;
      cx.fillRect(px-28,py-28,56,56);
    }
  });
  cx.restore();
}

// ── EXTRA CITY DETAIL ─────────────────────────────────
function drawMegaCityBackdrop(x,y,w,h,horizon){
  cx.save();
  cx.beginPath(); cx.rect(x,y,w,h); cx.clip();
  const towers=[
    {px:.08,bw:.07,bh:.58,c:'#070513',top:'spire',neon:'#00e5ff'},
    {px:.19,bw:.10,bh:.48,c:'#0b0718',top:'flat',neon:'#ff40b8'},
    {px:.34,bw:.06,bh:.66,c:'#080615',top:'antenna',neon:'#d081ff'},
    {px:.56,bw:.12,bh:.54,c:'#0b071b',top:'bridge',neon:'#ffab40'},
    {px:.74,bw:.08,bh:.62,c:'#090616',top:'spire',neon:'#70f0ff'},
    {px:.89,bw:.11,bh:.44,c:'#0e081c',top:'flat',neon:'#ff4081'},
  ];
  towers.forEach((t,i)=>{
    const bx=x+t.px*w, bw=t.bw*w, bh=t.bh*h, by=y+h-10-bh;
    const tg=cx.createLinearGradient(bx,by,bx+bw,by+bh);
    tg.addColorStop(0,t.c); tg.addColorStop(.55,'#120820'); tg.addColorStop(1,'#05030b');
    cx.fillStyle=tg; rr(cx,bx,by,bw,bh,3,true,false);
    cx.fillStyle='rgba(255,255,255,.035)'; cx.fillRect(bx+2,by,bw*.18,bh);
    for(let yy=by+10; yy<by+bh-6; yy+=12){
      for(let xx=bx+6; xx<bx+bw-4; xx+=10){
        const flick=.55+.45*Math.sin(S.t*.7+i+xx*.02+yy*.03);
        if(((xx+yy+i*13)|0)%4!==0){
          cx.fillStyle=((xx+i)%3===0)?`rgba(140,225,255,${.22*flick})`:`rgba(255,180,230,${.18*flick})`;
          cx.fillRect(xx,yy,2,2);
        }
      }
    }
    cx.strokeStyle=t.neon; cx.globalAlpha=.55+.25*Math.sin(S.t*1.4+i); cx.lineWidth=1;
    if(t.top==='spire'){
      cx.beginPath(); cx.moveTo(bx+bw*.5,by); cx.lineTo(bx+bw*.5,by-26); cx.stroke();
      cx.beginPath(); cx.arc(bx+bw*.5,by-28,2,0,Math.PI*2); cx.fillStyle=t.neon; cx.fill();
    } else if(t.top==='antenna'){
      for(let a=-1;a<=1;a++) { cx.beginPath(); cx.moveTo(bx+bw*(.5+a*.18),by); cx.lineTo(bx+bw*(.5+a*.18),by-18-a*5); cx.stroke(); }
    } else if(t.top==='bridge'){
      cx.beginPath(); cx.moveTo(bx+bw*.15,by+18); cx.lineTo(bx+bw*.85,by+6); cx.stroke();
    } else {
      cx.fillStyle=t.neon; cx.fillRect(bx+bw*.18,by+8,bw*.64,2);
    }
    cx.globalAlpha=1;
  });
  const railY=y+h*.68;
  cx.strokeStyle='rgba(170,110,255,.18)'; cx.lineWidth=2;
  cx.beginPath(); cx.moveTo(x+w*.03,railY); cx.bezierCurveTo(x+w*.3,railY-18,x+w*.66,railY+12,x+w*.98,railY-10); cx.stroke();
  for(let i=0;i<4;i++){
    const tx=x+((S.t*.025+i*.26)%1)*w;
    const ty=railY+Math.sin((tx-x)/w*Math.PI*2)*7;
    cx.fillStyle='rgba(130,220,255,.75)'; rr(cx,tx,ty,16,4,2,true,false);
    cx.fillStyle='rgba(130,220,255,.16)'; rr(cx,tx-10,ty-1,26,6,3,true,false);
  }
  for(let i=0;i<5;i++){
    const hx=x+(i*.23+.04)*w;
    const hy=horizon-10+Math.sin(S.t*.08+i)*3;
    const hg=cx.createRadialGradient(hx,hy,0,hx,hy,w*.22);
    hg.addColorStop(0,'rgba(190,90,255,.045)'); hg.addColorStop(1,'transparent');
    cx.fillStyle=hg; cx.fillRect(x,y,w,h);
  }
  cx.restore();
}

function drawNearCityPolish(x,y,w,h,roadY){
  cx.save(); cx.beginPath(); cx.rect(x,y,w,h); cx.clip();
  for(let i=0;i<9;i++){
    const bx=x+18+i*43;
    const by=roadY-20-(i%3)*7;
    cx.fillStyle='rgba(5,3,12,.88)'; rr(cx,bx,by,34+(i%2)*15,20+(i%4)*5,2,true,false);
    cx.fillStyle=i%2?'rgba(255,70,180,.55)':'rgba(90,220,255,.55)';
    if(Math.sin(S.t*1.2+i)>.15) cx.fillRect(bx+5,by+4,18,2);
  }
  for(let i=0;i<18;i++){
    const gx=x+((i*31)%w);
    const gy=y+18+((i*47)%(h-46));
    const a=.025+.025*Math.sin(S.t*.9+i);
    cx.fillStyle=`rgba(220,235,255,${a})`;
    cx.fillRect(gx,gy,1,8+(i%4)*5);
  }
  cx.restore();
}


// ── HUSH OS v0.35 CINEMATIC WORLD POLISH ───────────────────────

function drawV11WindowGlass(x,y,w,h){
  cx.save();
  cx.beginPath(); cx.rect(x,y,w,h); cx.clip();

  // Subtle stuck-on-glass droplets and distortion glints. These do not fall like rain.
  for(let i=0;i<18;i++){
    const px=x+((i*37)%w);
    const py=y+14+((i*53)%(h-30));
    const drift=Math.sin(S.t*.18+i)*1.5;
    cx.strokeStyle=`rgba(220,235,255,${.055+(i%4)*.012})`;
    cx.lineWidth=.7;
    cx.beginPath(); cx.moveTo(px+drift,py); cx.quadraticCurveTo(px+1+drift,py+8,px-1+drift,py+16+(i%3)*4); cx.stroke();
  }

  // A very faint refractive sweep across glass when the window is open.
  if(S.winAnim>.05){
    const sweep=x+((S.t*.035)%1)*w;
    const gg=cx.createLinearGradient(sweep-20,y,sweep+28,y+h);
    gg.addColorStop(0,'transparent');
    gg.addColorStop(.45,`rgba(200,230,255,${.045*S.winAnim})`);
    gg.addColorStop(1,'transparent');
    cx.fillStyle=gg; cx.fillRect(sweep-24,y,56,h);
  }
  cx.restore();
}

function mixRGB3(day,sunset,night){
  const tp=timeProfile();
  return [
    day[0]*tp.day + sunset[0]*tp.sunset + night[0]*tp.night,
    day[1]*tp.day + sunset[1]*tp.sunset + night[1]*tp.night,
    day[2]*tp.day + sunset[2]*tp.sunset + night[2]*tp.night,
  ];
}
function rgbaFromRGB(rgb,a){return `rgba(${rgb[0]|0},${rgb[1]|0},${rgb[2]|0},${a.toFixed(3)})`;}
function drawBlendedWindowSky(x,y,w,h,horizon){
  const tp=timeProfile();
  const rainy=!!(S.weather && (S.weather.rain || S.weather.thunderstorm));
  const snowy=!!(S.weather && S.weather.snow);
  const weatherDim=rainy ? (.16*tp.day + .09*tp.sunset) : (snowy ? .07*tp.day : 0);

  cx.save();
  cx.beginPath(); cx.rect(x,y,w,h); cx.clip();

  const top=mixRGB3([92,136,172],[80,44,80],[1,0,8]);
  const mid=mixRGB3([140,176,196],[182,96,88],[18,5,48]);
  const hor=mixRGB3([188,202,198],[245,138,78],[64,12,96]);
  const low=mixRGB3([88,106,118],[112,58,72],[8,3,18]);

  const g=cx.createLinearGradient(x,y,x,y+h);
  g.addColorStop(0,rgbaFromRGB(top,1));
  g.addColorStop(.45,rgbaFromRGB(mid,1));
  g.addColorStop(.70,rgbaFromRGB(hor,1));
  g.addColorStop(1,rgbaFromRGB(low,1));
  cx.fillStyle=g;
  cx.fillRect(x,y,w,h);

  if(tp.day>.01){
    cx.globalCompositeOperation='screen';
    const sunX=x+w*.30;
    const sunY=y+h*.22;
    const sun=cx.createRadialGradient(sunX,sunY,0,sunX,sunY,w*.56);
    sun.addColorStop(0,`rgba(255,245,210,${(.15*tp.day).toFixed(3)})`);
    sun.addColorStop(.16,`rgba(255,235,190,${(.070*tp.day).toFixed(3)})`);
    sun.addColorStop(.55,`rgba(210,230,245,${(.032*tp.day).toFixed(3)})`);
    sun.addColorStop(1,'transparent');
    cx.fillStyle=sun;
    cx.fillRect(x,y,w,h);

    const haze=cx.createLinearGradient(x,y,x,y+h);
    haze.addColorStop(0,`rgba(205,225,235,${(.10*tp.day).toFixed(3)})`);
    haze.addColorStop(.55,`rgba(160,190,205,${(.060*tp.day).toFixed(3)})`);
    haze.addColorStop(1,'transparent');
    cx.fillStyle=haze;
    cx.fillRect(x,y,w,h);
    cx.globalCompositeOperation='source-over';
  }

  if(tp.sunset>.01){
    const sx=x+w*.34, sy=horizon-h*.10;
    const sg=cx.createRadialGradient(sx,sy,0,sx,sy,w*.86);
    sg.addColorStop(0,`rgba(255,154,84,${(.25*tp.sunset).toFixed(3)})`);
    sg.addColorStop(.26,`rgba(245,96,115,${(.13*tp.sunset).toFixed(3)})`);
    sg.addColorStop(.58,`rgba(150,54,130,${(.06*tp.sunset).toFixed(3)})`);
    sg.addColorStop(1,'transparent');
    cx.globalCompositeOperation='screen';
    cx.fillStyle=sg;
    cx.fillRect(x,y,w,h);
    cx.globalCompositeOperation='source-over';
  }

  if(tp.night>.01){
    const ng=cx.createRadialGradient(x+w*.5,horizon,0,x+w*.5,horizon,w*.65);
    ng.addColorStop(0,`rgba(210,18,255,${(.22*S.neonPulse*tp.night).toFixed(3)})`);
    ng.addColorStop(.25,`rgba(160,10,200,${(.10*S.neonPulse*tp.night).toFixed(3)})`);
    ng.addColorStop(.62,`rgba(80,10,160,${(.05*tp.night).toFixed(3)})`);
    ng.addColorStop(1,'transparent');
    cx.globalCompositeOperation='screen';
    cx.fillStyle=ng;
    cx.fillRect(x,y,w,h);
    cx.globalCompositeOperation='source-over';
  }

  if(weatherDim>.001){
    cx.globalCompositeOperation='multiply';
    const over=cx.createLinearGradient(x,y,x,y+h);
    over.addColorStop(0,`rgba(86,92,96,${weatherDim.toFixed(3)})`);
    over.addColorStop(.55,`rgba(98,102,104,${(weatherDim*.86).toFixed(3)})`);
    over.addColorStop(1,`rgba(78,78,82,${(weatherDim*.62).toFixed(3)})`);
    cx.fillStyle=over;
    cx.fillRect(x,y,w,h);
    cx.globalCompositeOperation='source-over';
  }

  cx.restore();
}
function drawCityTimeAtmosphere(x,y,w,h,horizon){
  const tp=timeProfile();
  cx.save();
  cx.beginPath(); cx.rect(x,y,w,h); cx.clip();

  if(tp.day>.01){
    cx.globalCompositeOperation='screen';
    const dayFog=cx.createLinearGradient(x,y,x,y+h);
    dayFog.addColorStop(0,`rgba(145,185,205,${(.18*tp.day).toFixed(3)})`);
    dayFog.addColorStop(.55,`rgba(120,155,170,${(.12*tp.day).toFixed(3)})`);
    dayFog.addColorStop(1,`rgba(190,205,195,${(.055*tp.day).toFixed(3)})`);
    cx.fillStyle=dayFog;
    cx.fillRect(x,y,w,h);
    cx.globalCompositeOperation='multiply';
    cx.fillStyle=`rgba(150,165,170,${(.10*tp.day).toFixed(3)})`;
    cx.fillRect(x,y,w,h);
  }

  if(tp.sunset>.01){
    cx.globalCompositeOperation='screen';
    const duskFog=cx.createLinearGradient(x,y,x,y+h);
    duskFog.addColorStop(0,`rgba(130,60,90,${(.05*tp.sunset).toFixed(3)})`);
    duskFog.addColorStop(.50,`rgba(255,120,75,${(.12*tp.sunset).toFixed(3)})`);
    duskFog.addColorStop(1,`rgba(255,170,90,${(.07*tp.sunset).toFixed(3)})`);
    cx.fillStyle=duskFog;
    cx.fillRect(x,y,w,h);
  }

  cx.globalCompositeOperation='source-over';
  cx.restore();
}

// ── WINDOW VIEW ───────────────────────────────────────
function drawWindowView(){
  const {x,y,w,h}=R.win;
  const horizon=y+h*.72; // horizon line within window

  // v0.35: clock-driven sky. This now blends between blue day,
  // orange/pink sunset and deep violet night instead of always starting black.
  drawBlendedWindowSky(x,y,w,h,horizon);

  drawMegaCityBackdrop(x,y,w,h,horizon);
  drawCityTimeAtmosphere(x,y,w,h,horizon);

  // Stars — visible only at night, fade out at sunset/day
  const tp=timeProfile();
  const starA=clamp(tp.night-.1,.0,1)*clamp(1-tp.day*2,0,1);
  if(starA>.01){
    cx.save(); cx.beginPath(); cx.rect(x,y,w,h); cx.clip();
    stars.forEach(s=>{
      const sx=x+s.x*w, sy=y+s.y*(horizon-y);
      if(sx<x||sx>x+w||sy<y||sy>horizon) return;
      const twinkle=.72+.28*Math.sin(S.t*s.twinkleRate+s.twinkle);
      const alpha=s.a*starA*twinkle;
      cx.fillStyle=`rgba(235,240,255,${alpha})`;
      cx.beginPath(); cx.arc(sx,sy,s.r,0,Math.PI*2); cx.fill();
      // Very bright stars get a tiny cross-hair glint
      if(s.r>.9 && alpha>.45){
        cx.strokeStyle=`rgba(220,235,255,${alpha*.3})`;
        cx.lineWidth=.5;
        cx.beginPath(); cx.moveTo(sx-3,sy); cx.lineTo(sx+3,sy); cx.stroke();
        cx.beginPath(); cx.moveTo(sx,sy-3); cx.lineTo(sx,sy+3); cx.stroke();
        cx.lineWidth=1;
      }
    });
    cx.restore();
  }

  // ── MOON ──────────────────────────────────────────────
  // Crescent, visible at night and early sunset
  if(starA>.01){
    cx.save(); cx.beginPath(); cx.rect(x,y,w,h); cx.clip();
    const mx=x+MOON.px*w, my=y+MOON.py*(horizon-y);
    const moonA=clamp(starA*1.4,0,1);
    // Outer disc
    const mg=cx.createRadialGradient(mx,my,0,mx,my,MOON.r);
    mg.addColorStop(0,`rgba(230,235,210,${moonA*.92})`);
    mg.addColorStop(.6,`rgba(200,215,185,${moonA*.70})`);
    mg.addColorStop(1,'transparent');
    cx.fillStyle=mg; cx.beginPath(); cx.arc(mx,my,MOON.r+4,0,Math.PI*2); cx.fill();
    // Crescent cutout using destination-out trick on a temp offscreen
    cx.globalCompositeOperation='source-over';
    cx.fillStyle=`rgba(230,235,210,${moonA*.88})`;
    cx.beginPath(); cx.arc(mx,my,MOON.r,0,Math.PI*2); cx.fill();
    // Cut shadow by drawing a slightly offset dark circle
    cx.globalCompositeOperation='destination-out';
    cx.fillStyle='rgba(0,0,0,1)';
    cx.beginPath(); cx.arc(mx+MOON.r*.52,my-MOON.r*.12,MOON.r*.88,0,Math.PI*2); cx.fill();
    cx.globalCompositeOperation='source-over';
    // Halo
    const halo=cx.createRadialGradient(mx,my,MOON.r,mx,my,MOON.r+22);
    halo.addColorStop(0,`rgba(210,220,190,${moonA*.08})`);
    halo.addColorStop(1,'transparent');
    cx.fillStyle=halo; cx.beginPath(); cx.arc(mx,my,MOON.r+22,0,Math.PI*2); cx.fill();
    cx.restore();
  }

  // ── CLOUDS ────────────────────────────────────────────
  // Slow-drifting, day/sunset only
  const cloudA=clamp(tp.day*.9+tp.sunset*.45,0,1);
  if(cloudA>.01){
    cx.save(); cx.beginPath(); cx.rect(x,y,w,horizon); cx.clip();
    clouds.forEach(c=>{
      c.x=(c.x+c.speed)%1.12;
      const cx2=x+c.x*w, cy2=y+c.y*(horizon-y);
      cx.save();
      cx.translate(cx2,cy2);
      cx.scale(c.scale,c.scale*.55);
      cx.globalAlpha=c.alpha*cloudA;
      // Day clouds: white-grey. Sunset: warm peach-pink tint
      const rr2=tp.sunset/(tp.day+tp.sunset+.001);
      const cr=(200+55*rr2)|0, cg2=(185+45*(1-rr2))|0, cb=(185+55*(1-rr2))|0;
      c.puffs.forEach(p=>{
        const pg=cx.createRadialGradient(p.ox,p.oy,0,p.ox,p.oy,p.rx);
        pg.addColorStop(0,`rgba(${cr},${cg2},${cb},.95)`);
        pg.addColorStop(.55,`rgba(${cr},${cg2},${cb},.55)`);
        pg.addColorStop(1,'transparent');
        cx.fillStyle=pg;
        cx.beginPath(); cx.ellipse(p.ox,p.oy,p.rx,p.ry,0,0,Math.PI*2); cx.fill();
      });
      cx.restore();
    });
    cx.restore();
  }
  cx.save(); cx.beginPath(); cx.rect(x,y,w,h); cx.clip();

  cityLayers.forEach((layer,li)=>{
    // Each layer scrolls at its own rate
    // offset = S.cityOffset * layer.depth (small fraction)
    // We draw buildings tiled across 2x CITY_W to avoid gaps
    const layerOffset = 0;
    const groundY = y + h - 8 - li * 12; // closer layers sit lower

    layer.buildings.forEach(b=>{
      // Draw building at two positions to handle wrap
      [-CITY_W, 0].forEach(wrap=>{
        // Map building x into window space
        const bxRaw = x + (b.x - layerOffset + wrap) / CITY_W * w;
        // Only draw if visible
        if(bxRaw + b.w < x || bxRaw > x+w) return;

        const by = groundY - b.h;
        const bg=cx.createLinearGradient(bxRaw,by,bxRaw+b.w,by+b.h);
        bg.addColorStop(0,b.shade);
        bg.addColorStop(.5,'#13091f');
        bg.addColorStop(1,'#06030b');
        cx.fillStyle=bg;
        rr(cx,bxRaw,by,b.w,b.h,2,true,false);
        cx.fillStyle='rgba(255,255,255,.035)';
        cx.fillRect(bxRaw+1,by+1,Math.max(1,b.w*.12),b.h-2);
        if(li>=2){
          cx.strokeStyle='rgba(150,90,255,.14)';
          cx.beginPath(); cx.moveTo(bxRaw+b.w*.12,by+4); cx.lineTo(bxRaw+b.w*.88,by+1); cx.stroke();
        }

        // Windows
        b.wins.forEach(win=>{
          if(S.t-win.last>win.rate/1000){win.on=!win.on;win.last=S.t}
          if(!win.on)return;
          const wx=bxRaw+win.ox, wy=by+win.oy;
          if(wx<x||wx>x+w||wy<y||wy>y+h)return;
          cx.fillStyle=win.warm?'rgba(255,230,170,.85)':'rgba(160,220,255,.75)';
          cx.fillRect(wx, wy, Math.max(1.5,b.w*.08), 1.5);
        });

        // Neon sign
        if(b.sign&&li>=2){
          const flk=.65+Math.sin(S.t*1.8+b.x*.01)*.22;
          if(flk>.15){
            const sx=bxRaw+b.w*.14, sy=by+b.h*.12, sw=b.w*.6, sh=Math.max(12,b.h*.2);
            cx.strokeStyle=b.signCol;
            cx.lineWidth=1.2;
            cx.globalAlpha=flk;
            rr(cx,sx,sy,sw,sh,3,false,true);
            cx.font=`${Math.max(8,sw*.35)}px sans-serif`;
            cx.fillStyle=b.signCol;
            cx.fillText(b.signText,sx+3,sy+sh*.72);
            cx.globalAlpha=1;
            cx.lineWidth=1;
          }
        }

        // LED billboard screen
        if(b.screen&&li>=2){
          const sx=bxRaw+b.w*.3, sy=by+b.h*.28, sw=b.w*.28, sh=b.h*.3;
          const pg=cx.createLinearGradient(sx,sy,sx+sw,sy+sh);
          const phase=(S.t*.4+b.screenPh)%(Math.PI*2);
          pg.addColorStop(0,`rgba(${200+Math.sin(phase)*55|0},50,${180+Math.cos(phase)*75|0},.85)`);
          pg.addColorStop(1,`rgba(50,${130+Math.sin(phase)*80|0},255,.85)`);
          cx.fillStyle=pg;
          rr(cx,sx,sy,sw,sh,2,true,false);
        }
      });
    });
  });

  drawDistantLife(x,y,w,h);

  // Elevated highway
  const roadY=y+h-16;
  cx.fillStyle='rgba(10,6,20,.94)'; cx.fillRect(x,roadY,w,10);
  cx.fillStyle='rgba(255,255,255,.04)'; cx.fillRect(x,roadY+1,w,1);
  // Road lane line
  cx.fillStyle='rgba(255,255,100,.06)'; cx.fillRect(x,roadY+5,w,1);

  // Traffic
  traffic.forEach(t=>{
    t.x=(t.x+t.spd*.001*t.dir+1)%1;
    const laneOff=t.lane?1:3;
    const tx=x+t.x*w;
    for(let i=0;i<t.tail;i++){
      const ttx=tx-i*t.dir*1.8;
      if(ttx<x||ttx>x+w)continue;
      cx.globalAlpha=(1-i/t.tail)*.75;
      cx.fillStyle=t.col;
      cx.fillRect(ttx,roadY+laneOff,1.5,1.5);
    }
    cx.globalAlpha=1;
  });

  // Ground / wet street below road
  const grd=cx.createLinearGradient(0,roadY+10,0,y+h);
  grd.addColorStop(0,'rgba(14,6,28,.95)'); grd.addColorStop(1,'rgba(8,3,16,1)');
  cx.fillStyle=grd; cx.fillRect(x,roadY+10,w,y+h-roadY-10);

  // Wet street neon reflections
  cx.save(); cx.globalAlpha=.18;
  const refG=cx.createLinearGradient(x+w*.2,roadY+10,x+w*.8,y+h);
  refG.addColorStop(0,'rgba(200,20,255,.4)');
  refG.addColorStop(.5,'rgba(100,80,255,.2)');
  refG.addColorStop(1,'rgba(255,30,180,.3)');
  cx.fillStyle=refG;
  cx.fillRect(x,roadY+10,w,y+h-roadY-10);
  cx.restore();

  drawNearCityPolish(x,y,w,h,roadY);
  drawCityTimeAtmosphere(x,y,w,h,horizon);


  // Far rain
  if(S.weather.rain || S.weather.thunderstorm) rainFar.forEach(r=>{
    r.y+=r.spd*.0018; if(r.y>1.1)r.y=-.08;
    const rx=x+r.x*w, ry=y+r.y*h;
    if(rx<x||rx>x+w||ry<y||ry>y+h)return;
    cx.strokeStyle=`rgba(180,215,255,${r.a})`;
    cx.lineWidth=.6;
    cx.beginPath();cx.moveTo(rx,ry);cx.lineTo(rx-r.len*.1,ry+r.len);cx.stroke();
  });

  // Glass reflections — vertical light streaks on pane
  cx.save(); cx.globalAlpha=.07;
  for(let i=0;i<7;i++){
    const gx=x+38+i*50;
    const gg=cx.createLinearGradient(gx,y,gx+12,y+h);
    gg.addColorStop(0,'rgba(255,200,255,.6)');
    gg.addColorStop(.5,'rgba(200,180,255,.3)');
    gg.addColorStop(1,'transparent');
    cx.fillStyle=gg; cx.fillRect(gx,y,2,h);
  }
  cx.restore();

  drawV11WindowGlass(x,y,w,h);

  // Glass rain rivulets (when focused on window)
  if((S.weather.rain || S.weather.thunderstorm) && S.focus==='window'){
    rainGlass.forEach(r=>{
      r.y+=r.spd*.0022; if(r.y>1.12)r.y=-.1;
      const rx=x+r.x*w, ry=y+r.y*h;
      cx.strokeStyle=`rgba(210,235,255,${r.a})`;
      cx.lineWidth=.8;
      cx.beginPath();cx.moveTo(rx,ry);cx.lineTo(rx-r.len*.12,ry+r.len);cx.stroke();
    });
  }

  cx.restore(); // unclip
}


// ── LEAN-OUT CITY VIEW ────────────────────────────────
function drawLeanOutCityOverlay(){
  const a=clamp(S.leanAnim||0,0,1);
  if(a<=0.005) return;
  const ease=a*a*(3-2*a);

  const lookX=clamp(S.mx||0,-1,1);
  const lookY=clamp(S.my||0,-1,1);
  const lookDown=clamp((lookY+.08)/.92,0,1);
  const lookUp=clamp((-lookY-.28)/.72,0,1);

  cx.save();
  cx.globalAlpha=ease;

  const vpX=W*.5 - lookX*76;
  const horizon=lerp(H*.52,H*.18,lookDown) + lookUp*24;
  const cityScale=lerp(1.42,1.92,lookDown);
  const verticalDrop=lookDown*96;

  const sky=cx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,'#010008');
  sky.addColorStop(.16,'#050116');
  sky.addColorStop(.35,'#13042f');
  sky.addColorStop(.54,'#2a0a58');
  sky.addColorStop(.72,'#170526');
  sky.addColorStop(1,'#030107');
  cx.fillStyle=sky; cx.fillRect(0,0,W,H);

  const pulse=.86+Math.sin(S.t*.55)*.09+Math.sin(S.t*1.17)*.045;
  const bloom=cx.createRadialGradient(vpX,horizon+10,0,vpX,horizon+10,W*.78);
  bloom.addColorStop(0,`rgba(210,18,255,${.26*pulse})`);
  bloom.addColorStop(.24,`rgba(80,210,255,${.08*pulse})`);
  bloom.addColorStop(.62,'rgba(80,10,160,.055)');
  bloom.addColorStop(1,'transparent');
  cx.fillStyle=bloom; cx.fillRect(0,0,W,H);

  for(let i=0;i<7;i++){
    const yy=horizon-72+i*24;
    const g=cx.createLinearGradient(0,yy,0,yy+56);
    g.addColorStop(0,`rgba(120,130,205,${.015+i*.006})`);
    g.addColorStop(1,'transparent');
    cx.fillStyle=g; cx.fillRect(0,yy,W,60);
  }

  // Unified city projection: the same cityLayers used by the interior window view.
  cx.save();
  cityLayers.forEach((layer,li)=>{
    const depth=(li+1)/cityLayers.length;
    const ground=horizon + 70 + li*28 + verticalDrop*(.34+depth*.70);
    const pan=lookX*(46+li*48);
    const layerScale=cityScale*(.78+li*.18);

    layer.buildings.forEach(b=>{
      const u=b.x/CITY_W;
      const bx=vpX + (u-.5)*W*1.42*layerScale - pan*depth;
      const bw=Math.max(7,b.w*layerScale*(1.15+li*.05));
      const bh=Math.max(20,b.h*layerScale*(1.1+li*.08));
      const by=ground-bh;
      if(bx+bw<-90 || bx>W+90 || by>H+120) return;

      const grad=cx.createLinearGradient(bx,by,bx+bw,by+bh);
      grad.addColorStop(0,b.shade||'#0b0614');
      grad.addColorStop(.46,'#11071a');
      grad.addColorStop(1,'#020106');
      cx.fillStyle=grad;
      rr(cx,bx,by,bw,bh,Math.max(2,4-li*.45),true,false);

      const sideW=Math.max(2,bw*.14);
      cx.fillStyle='rgba(255,255,255,.035)';
      cx.beginPath(); cx.moveTo(bx+2,by+2); cx.lineTo(bx+sideW,by+5); cx.lineTo(bx+sideW,by+bh-4); cx.lineTo(bx+2,by+bh-2); cx.closePath(); cx.fill();
      cx.fillStyle='rgba(0,0,0,.28)';
      cx.beginPath(); cx.moveTo(bx+bw-sideW,by+4); cx.lineTo(bx+bw-1,by+1); cx.lineTo(bx+bw-1,by+bh-1); cx.lineTo(bx+bw-sideW,by+bh-5); cx.closePath(); cx.fill();

      b.wins.forEach(win=>{
        if(S.t-win.last>win.rate/1000){win.on=!win.on;win.last=S.t}
        if(!win.on)return;
        const wx=bx+(win.ox/b.w)*bw;
        const wy=by+(win.oy/b.h)*bh;
        if(wx<-2||wx>W+2||wy<-2||wy>H+2)return;
        const twinkle=.65+.35*Math.sin(S.t*.8+wx*.021+wy*.017);
        cx.fillStyle=win.warm?`rgba(255,225,165,${.28*twinkle})`:`rgba(145,220,255,${.25*twinkle})`;
        cx.fillRect(wx,wy,Math.max(1.2,bw*.055),1.4);
      });

      if(b.sign&&li>=1){
        const sx=bx+bw*.14, sy=by+bh*.16, sw=bw*.62, sh=Math.max(10,bh*.14);
        const fl=clamp(.55+.25*Math.sin(S.t*1.5+b.x*.01)+.10*Math.sin(S.t*5.1+b.x*.02),.18,.95);
        cx.globalAlpha=ease*fl;
        cx.strokeStyle=b.signCol||'#00e5ff'; cx.lineWidth=1.15;
        rr(cx,sx,sy,sw,sh,3,false,true);
        cx.fillStyle=b.signCol||'#00e5ff';
        cx.fillRect(sx+4,sy+sh*.48,sw-8,1.4);
        cx.globalAlpha=ease;
      }

      if(b.screen&&li>=1){
        const sx=bx+bw*.34, sy=by+bh*.30, sw=bw*.28, sh=bh*.22;
        const phase=(S.t*.4+b.screenPh)%(Math.PI*2);
        const pg=cx.createLinearGradient(sx,sy,sx+sw,sy+sh);
        pg.addColorStop(0,`rgba(${200+Math.sin(phase)*55|0},55,${180+Math.cos(phase)*75|0},.82)`);
        pg.addColorStop(1,`rgba(40,${130+Math.sin(phase)*80|0},255,.82)`);
        cx.fillStyle=pg; rr(cx,sx,sy,sw,sh,2,true,false);
      }
    });
  });
  cx.restore();

  const roadY=horizon+170+lookDown*75;
  cx.save();
  cx.globalAlpha=ease*(.82-lookDown*.18);
  cx.fillStyle='rgba(7,4,16,.88)';
  cx.fillRect(-40,roadY,W+80,12);
  cx.fillStyle='rgba(255,255,255,.045)'; cx.fillRect(-40,roadY+1,W+80,1);
  traffic.forEach(t=>{
    const tx=((t.x*W*1.25 + W*.5 - W*.625) + lookX*38 + W)%W;
    const yy=roadY+(t.lane?3:7);
    const len=t.tail*1.5;
    const gr=cx.createLinearGradient(tx,yy,tx-t.dir*len,yy);
    gr.addColorStop(0,t.col); gr.addColorStop(1,'transparent');
    cx.strokeStyle=gr; cx.lineWidth=1.3;
    cx.beginPath(); cx.moveTo(tx,yy); cx.lineTo(tx-t.dir*len,yy); cx.stroke();
  });
  cx.restore();

  cx.save();
  const streetA=ease*clamp((lookDown-.06)/.94,0,1);
  cx.globalAlpha=streetA;
  const streetTop=lerp(H*.88,H*.30,lookDown);
  const streetBottom=H+32;
  const roadHalfTop=lerp(38,18,lookDown);

  const road=cx.createLinearGradient(0,streetTop,0,H);
  road.addColorStop(0,'rgba(10,6,18,.22)');
  road.addColorStop(.42,'rgba(9,5,18,.9)');
  road.addColorStop(1,'rgba(2,1,6,1)');
  cx.fillStyle=road;
  cx.beginPath();
  cx.moveTo(vpX-roadHalfTop,streetTop);
  cx.lineTo(vpX+roadHalfTop,streetTop);
  cx.lineTo(W+120,streetBottom);
  cx.lineTo(-120,streetBottom);
  cx.closePath(); cx.fill();

  const sideA=clamp((lookDown-.12)/.88,0,1);
  cx.globalAlpha=streetA*sideA*.92;
  const leftG=cx.createLinearGradient(0,streetTop,190,H);
  leftG.addColorStop(0,'rgba(5,3,12,.10)'); leftG.addColorStop(.48,'rgba(8,4,18,.74)'); leftG.addColorStop(1,'rgba(1,1,5,.98)');
  cx.fillStyle=leftG;
  cx.beginPath(); cx.moveTo(0,streetTop-8); cx.lineTo(vpX-70,streetTop+12); cx.lineTo(178,H+32); cx.lineTo(0,H+32); cx.closePath(); cx.fill();
  const rightG=cx.createLinearGradient(W,streetTop,W-190,H);
  rightG.addColorStop(0,'rgba(5,3,12,.10)'); rightG.addColorStop(.48,'rgba(8,4,18,.74)'); rightG.addColorStop(1,'rgba(1,1,5,.98)');
  cx.fillStyle=rightG;
  cx.beginPath(); cx.moveTo(W,streetTop-8); cx.lineTo(vpX+70,streetTop+12); cx.lineTo(W-178,H+32); cx.lineTo(W,H+32); cx.closePath(); cx.fill();

  for(let i=0;i<26;i++){
    const yy=streetTop+20+i*13;
    if(yy>H) continue;
    const p=(yy-streetTop)/(H-streetTop);
    const la=.16+.16*Math.sin(S.t*.9+i);
    cx.fillStyle=i%2?`rgba(255,205,140,${la})`:`rgba(110,220,255,${la*.85})`;
    cx.fillRect(24+p*66,yy,8+p*4,2);
    cx.fillRect(W-34-p*66,yy+5,8+p*4,2);
  }

  cx.globalAlpha=streetA;
  cx.strokeStyle='rgba(100,190,255,.18)'; cx.lineWidth=1.1;
  for(let i=-5;i<=5;i++){
    cx.beginPath();
    cx.moveTo(vpX+i*10,streetTop+4);
    cx.lineTo(W*.5+i*92-lookX*42,H+24);
    cx.stroke();
  }
  cx.strokeStyle='rgba(255,70,210,.13)';
  for(let j=0;j<7;j++){
    const yy=streetTop+22+j*25+lookDown*j*5;
    cx.beginPath(); cx.moveTo(-30,yy); cx.quadraticCurveTo(vpX,yy-16,W+30,yy+8); cx.stroke();
  }

  leanTraffic.forEach(t=>{
    const lane=(t.y-.73)/.20;
    const depth=clamp(lane,0,1);
    const px=(t.x*W + lookX*(20+depth*50))%W;
    const py=streetTop + depth*(H-streetTop) + Math.sin(S.t*.8+t.x*6)*2;
    const len=t.tail*(.7+depth*1.2)*(1+lookDown*.55);
    const gr=cx.createLinearGradient(px,py,px-t.dir*len,py+1);
    gr.addColorStop(0,t.col); gr.addColorStop(1,'transparent');
    cx.strokeStyle=gr; cx.lineWidth=1.2+depth*.9;
    cx.beginPath(); cx.moveTo(px,py); cx.lineTo(px-t.dir*len,py+1); cx.stroke();
  });

  for(let i=0;i<32;i++){
    const px=((i*37)%W)+Math.sin(S.t*.7+i)*1.5+lookX*12;
    const py=streetTop+35+((i*53)%(Math.max(30,H-streetTop-45)));
    const blink=.35+.35*Math.sin(S.t*1.4+i);
    cx.fillStyle=i%3===0?`rgba(255,210,130,${.18+blink*.25})`:`rgba(120,220,255,${.12+blink*.18})`;
    cx.fillRect(px,py,1.2,2.2);
  }

  const wet=cx.createRadialGradient(vpX,H*.80,0,vpX,H*.80,W*.62);
  wet.addColorStop(0,'rgba(120,200,255,.10)');
  wet.addColorStop(.34,'rgba(255,60,210,.075)');
  wet.addColorStop(1,'transparent');
  cx.fillStyle=wet; cx.fillRect(0,streetTop,W,H-streetTop);
  cx.restore();

  cx.save();
  cx.globalAlpha=ease*(.32+.16*lookDown);
  for(let i=0;i<110;i++){
    const rx=((i*47 + S.t*94*(.65+(i%5)*.08) + lookX*22)%W+W)%W;
    const ry=((i*83 + S.t*158*(.45+(i%7)*.05))%H);
    const l=9+(i%8)*2+lookDown*5;
    cx.strokeStyle=`rgba(200,225,255,${.065+(i%4)*.014})`;
    cx.beginPath(); cx.moveTo(rx,ry); cx.lineTo(rx-2,ry+l); cx.stroke();
  }
  cx.restore();

  const edgeA=.52*ease;
  cx.fillStyle=`rgba(5,3,10,${edgeA})`;
  cx.fillRect(0,0,18,H); cx.fillRect(W-18,0,18,H); cx.fillRect(0,0,W,16); cx.fillRect(0,H-18,W,18);
  cx.strokeStyle=`rgba(200,230,255,${.12*ease})`; cx.lineWidth=1;
  cx.strokeRect(19,17,W-38,H-36);

  const refl=cx.createLinearGradient(0,0,W,H);
  refl.addColorStop(0,`rgba(255,180,120,${.028*ease})`);
  refl.addColorStop(.45,'transparent');
  refl.addColorStop(1,`rgba(140,200,255,${.040*ease})`);
  cx.fillStyle=refl; cx.fillRect(0,0,W,H);

  cx.globalAlpha=ease*.24;
  cx.font='7px monospace';
  cx.fillStyle='rgba(230,240,255,.55)';
  cx.fillText('MOVE MOUSE: PAN SKYLINE / LOOK DOWN',24,H-26);
  cx.globalAlpha=ease;

  cx.restore();
}

// ── WINDOW FRAME ──────────────────────────────────────

function drawNeonSpillOnWalls(){
  // City light bleeds through window onto interior walls
  // This is the key 'Replaced' / NEONnoir lighting effect

  const {x,y,w,h}=R.win;

  // Left wall — magenta/purple spill
  cx.save();
  for(let i=0;i<5;i++){
    const dist=(R.win.x-(W*.04))*(.15+i*.18);
    const lg=cx.createLinearGradient(x-1,0,x-1-dist,0);
    lg.addColorStop(0,'rgba(160,20,220,.09)');
    lg.addColorStop(1,'transparent');
    cx.fillStyle=lg;
    cx.fillRect(x-1-dist,y-8,dist,h+16);
  }
  cx.restore();

  // Right wall — cyan/blue spill
  cx.save();
  for(let i=0;i<5;i++){
    const dist=(W*.96-(x+w))*(.15+i*.18);
    const rg=cx.createLinearGradient(x+w+1,0,x+w+1+dist,0);
    rg.addColorStop(0,'rgba(100,60,220,.08)');
    rg.addColorStop(1,'transparent');
    cx.fillStyle=rg;
    cx.fillRect(x+w+1,y-8,dist,h+16);
  }
  cx.restore();

  // When the window opens, a cool outdoor wash creeps into the room.
  if((S.winAnim||0)>.01){
    const a=S.winAnim;
    const air=cx.createLinearGradient(x, y+h, x, R.floorY+95);
    air.addColorStop(0,`rgba(130,200,255,${.06*a})`);
    air.addColorStop(.55,`rgba(90,90,220,${.025*a})`);
    air.addColorStop(1,'transparent');
    cx.fillStyle=air;
    cx.fillRect(x-35,y+h,w+70,105);
  }

  // Floor — neon reflection pool directly below window
  const floorGlow=cx.createLinearGradient(x,R.floorY,x,R.floorY+80);
  floorGlow.addColorStop(0,'rgba(180,30,255,.1)');
  floorGlow.addColorStop(.5,'rgba(100,20,200,.04)');
  floorGlow.addColorStop(1,'transparent');
  cx.fillStyle=floorGlow;
  cx.fillRect(x-20,R.floorY,w+40,80);
}

// ── DESK ─────────────────────────────────────────────

function drawLamp(){
  const {x,y}=R.lamp;
  const flk=S.lampOn?S.lampFlk:0;
  // Glow colours: violet-to-ice-white to match the city
  const glowR=180, glowG=120, glowB=255;

  // ── Downward light cone ───────────────────────────
  if(S.lampOn){
    // Wide soft ambient spill
    const coneAlpha=.11*flk;
    const cg=cx.createLinearGradient(x,y-38,x,y+100);
    cg.addColorStop(0,`rgba(${glowR},${glowG},${glowB},${coneAlpha})`);
    cg.addColorStop(.45,`rgba(${glowR},${glowG},${glowB},${coneAlpha*.3})`);
    cg.addColorStop(1,'transparent');
    cx.fillStyle=cg;
    cx.beginPath();
    cx.moveTo(x-6,y-38); cx.lineTo(x+6,y-38);
    cx.lineTo(x+72,y+100); cx.lineTo(x-72,y+100);
    cx.closePath(); cx.fill();
    // Tight inner beam — brighter, cooler
    const core=cx.createLinearGradient(x,y-38,x,y+40);
    core.addColorStop(0,`rgba(220,200,255,${.28*flk})`);
    core.addColorStop(1,'transparent');
    cx.fillStyle=core;
    cx.beginPath();
    cx.moveTo(x-4,y-38); cx.lineTo(x+4,y-38);
    cx.lineTo(x+28,y+40); cx.lineTo(x-28,y+40);
    cx.closePath(); cx.fill();
  }

  // ── Base — heavy flat disc ────────────────────────
  // Outer disc shadow
  cx.save();
  cx.globalAlpha=.45;
  const baseSh=cx.createRadialGradient(x+4,y+16,2,x+4,y+16,30);
  baseSh.addColorStop(0,'rgba(0,0,0,.55)'); baseSh.addColorStop(1,'transparent');
  cx.fillStyle=baseSh; cx.fillRect(x-28,y+4,56,28);
  cx.restore();
  // Base disc — brushed dark alloy
  const baseG=cx.createLinearGradient(x-20,y+6,x+20,y+18);
  baseG.addColorStop(0,'#1a1a24'); baseG.addColorStop(.35,'#2a2a3a'); baseG.addColorStop(.65,'#18181f'); baseG.addColorStop(1,'#0e0e14');
  cx.fillStyle=baseG;
  cx.beginPath(); cx.ellipse(x,y+12,20,6,0,0,Math.PI*2); cx.fill();
  // Base highlight ring
  cx.strokeStyle='rgba(140,100,255,.35)'; cx.lineWidth=.8;
  cx.beginPath(); cx.ellipse(x,y+11,18,5,0,0,Math.PI*2); cx.stroke();
  cx.lineWidth=1;
  // Base foot rim — flat line at bottom
  cx.fillStyle='rgba(80,60,120,.55)';
  cx.beginPath(); cx.ellipse(x,y+16,16,3.5,0,0,Math.PI*2); cx.fill();

  // ── Arc neck — chrome sweep from base up and over ─
  // The arc goes: base centre → up → curves right → head
  const headX=x+28, headY=y-58; // where the shade hangs
  cx.save();
  // Neck shadow under arc
  cx.strokeStyle='rgba(0,0,0,.35)'; cx.lineWidth=5;
  cx.beginPath();
  cx.moveTo(x,y+8);
  cx.bezierCurveTo(x-6,y-22, x+4,y-48, headX,headY+4);
  cx.stroke();
  // Main neck — chrome gradient
  const neckG=cx.createLinearGradient(x-4,y,headX+4,headY);
  neckG.addColorStop(0,'#2a2430'); neckG.addColorStop(.3,'#4a4060'); neckG.addColorStop(.6,'#3a3050'); neckG.addColorStop(1,'#1e1828');
  cx.strokeStyle=neckG; cx.lineWidth=4;
  cx.beginPath();
  cx.moveTo(x,y+8);
  cx.bezierCurveTo(x-6,y-22, x+4,y-48, headX,headY+4);
  cx.stroke();
  // Neck highlight — thin chrome edge
  cx.strokeStyle='rgba(180,160,255,.28)'; cx.lineWidth=1;
  cx.beginPath();
  cx.moveTo(x-1,y+6);
  cx.bezierCurveTo(x-8,y-22, x+2,y-50, headX-2,headY+4);
  cx.stroke();
  cx.restore();

  // ── Shade — angled conical dish ───────────────────
  // Exterior — matte dark with purple edge
  const shadeG=cx.createLinearGradient(headX-28,headY-4,headX+14,headY+18);
  shadeG.addColorStop(0,'#12101a'); shadeG.addColorStop(.45,'#1e1a2c'); shadeG.addColorStop(1,'#0e0c16');
  cx.fillStyle=shadeG;
  cx.beginPath();
  cx.moveTo(headX-4,headY-2);   // top-left (narrow opening)
  cx.lineTo(headX+6,headY-2);   // top-right
  cx.lineTo(headX+24,headY+16); // bottom-right (wide mouth)
  cx.lineTo(headX-30,headY+16); // bottom-left
  cx.closePath(); cx.fill();
  // Shade outer edge accent
  cx.strokeStyle='rgba(120,80,200,.40)'; cx.lineWidth=.7;
  cx.beginPath();
  cx.moveTo(headX-4,headY-2); cx.lineTo(headX-30,headY+16);
  cx.moveTo(headX+6,headY-2); cx.lineTo(headX+24,headY+16);
  cx.stroke();
  // Shade bottom rim — bright neon strip
  cx.strokeStyle=S.lampOn?`rgba(${glowR},${glowG},${glowB},${.65*flk})`:'rgba(80,60,120,.35)';
  cx.lineWidth=1.2;
  cx.beginPath(); cx.moveTo(headX-30,headY+16); cx.lineTo(headX+24,headY+16); cx.stroke();
  cx.lineWidth=1;
  // Interior glow when on
  if(S.lampOn){
    const innerG=cx.createLinearGradient(headX-28,headY+2,headX+22,headY+16);
    innerG.addColorStop(0,`rgba(${glowR},${glowG},${glowB},${.45*flk})`);
    innerG.addColorStop(.5,`rgba(220,210,255,${.55*flk})`);
    innerG.addColorStop(1,`rgba(${glowR},${glowG},${glowB},${.3*flk})`);
    cx.fillStyle=innerG;
    cx.beginPath();
    cx.moveTo(headX-3,headY-1); cx.lineTo(headX+5,headY-1);
    cx.lineTo(headX+22,headY+15); cx.lineTo(headX-28,headY+15);
    cx.closePath(); cx.fill();
    // Bulb point — glowing dot
    cx.fillStyle=`rgba(240,230,255,${.9*flk})`;
    cx.beginPath(); cx.arc(headX+1,headY+6,3,0,Math.PI*2); cx.fill();
    cx.fillStyle=`rgba(255,255,255,${.7*flk})`;
    cx.beginPath(); cx.arc(headX+1,headY+6,1.5,0,Math.PI*2); cx.fill();
  } else {
    cx.fillStyle='rgba(30,24,48,.8)';
    cx.beginPath();
    cx.moveTo(headX-3,headY-1); cx.lineTo(headX+5,headY-1);
    cx.lineTo(headX+22,headY+15); cx.lineTo(headX-28,headY+15);
    cx.closePath(); cx.fill();
  }

  // ── Power cable ───────────────────────────────────
  cx.strokeStyle='rgba(14,10,22,.9)'; cx.lineWidth=1.2;
  cx.beginPath();
  cx.moveTo(x+4,y+14);
  cx.quadraticCurveTo(x+18,y+20, x+22,y+28);
  cx.stroke();

  // ── Focus ring ───────────────────────────────────
  if(S.focus==='lamp'){
    cx.strokeStyle='rgba(180,140,255,.45)'; cx.lineWidth=1.4;
    rr(cx,x-42,y-70,84,82,12,false,true); cx.lineWidth=1;
  }
}

// ── RADIO ────────────────────────────────────────────
// Vintage Bakelite tabletop radio — 1950s Grundig/Zenith aesthetic
// Layout at 116×42: domed Bakelite body, large speaker left, amber tuner window, two knobs right
function drawRadio(){
  const base=R.radio;
  const kick=(S.radioDeskKick||0)*Math.sin(S.t*84);
  const x=base.x+kick*.9, y=base.y+kick*.18, w=base.w, h=base.h;

  // ── Drop shadow ───────────────────────────────────
  cx.save();
  cx.globalAlpha=.35;
  const sh=cx.createRadialGradient(x+w*.5,y+h+3,2,x+w*.5,y+h+3,w*.55);
  sh.addColorStop(0,'rgba(0,0,0,.5)'); sh.addColorStop(1,'transparent');
  cx.fillStyle=sh; cx.fillRect(x-8,y+h-4,w+16,18);
  cx.restore();

  // ── Body — warm dark-chestnut Bakelite with domed top ─
  // Main body trapezoid (slightly wider at bottom — vintage form)
  cx.save();
  const bodyG=cx.createLinearGradient(x,y,x,y+h);
  bodyG.addColorStop(0,'#3d2a18');
  bodyG.addColorStop(.3,'#2e1f10');
  bodyG.addColorStop(.75,'#241608');
  bodyG.addColorStop(1,'#1a1006');
  cx.fillStyle=bodyG;
  cx.beginPath();
  cx.moveTo(x+5,y+2);          // top-left (slightly inset = dome effect)
  cx.quadraticCurveTo(x+w*.5,y-4, x+w-5,y+2); // domed top arc
  cx.lineTo(x+w+2,y+h);        // bottom-right (slightly wider)
  cx.lineTo(x-2,y+h);          // bottom-left
  cx.closePath();
  cx.fill();

  // Bakelite surface sheen — diagonal light catch
  const sheen=cx.createLinearGradient(x,y,x+w*.6,y+h*.7);
  sheen.addColorStop(0,'rgba(255,200,140,.09)');
  sheen.addColorStop(.4,'rgba(255,180,120,.04)');
  sheen.addColorStop(1,'transparent');
  cx.fillStyle=sheen;
  cx.beginPath();
  cx.moveTo(x+5,y+2);
  cx.quadraticCurveTo(x+w*.5,y-4, x+w-5,y+2);
  cx.lineTo(x+w+2,y+h);
  cx.lineTo(x-2,y+h);
  cx.closePath();
  cx.fill();

  // Top-edge highlight (dome rim)
  cx.strokeStyle='rgba(255,200,150,.22)'; cx.lineWidth=.8;
  cx.beginPath();
  cx.moveTo(x+6,y+2);
  cx.quadraticCurveTo(x+w*.5,y-3.5, x+w-6,y+2);
  cx.stroke();
  cx.lineWidth=1;
  cx.restore();

  // ── Speaker grille — left 55% of body ────────────
  const gx=x+4, gy=y+6, gw=60, gh=h-14;
  // Recessed panel
  cx.fillStyle='rgba(8,4,2,.72)';
  cx.beginPath();
  cx.moveTo(gx+3,gy); cx.lineTo(gx+gw-3,gy);
  cx.quadraticCurveTo(gx+gw,gy,gx+gw,gy+3);
  cx.lineTo(gx+gw,gy+gh-3); cx.quadraticCurveTo(gx+gw,gy+gh,gx+gw-3,gy+gh);
  cx.lineTo(gx+3,gy+gh); cx.quadraticCurveTo(gx,gy+gh,gx,gy+gh-3);
  cx.lineTo(gx,gy+3); cx.quadraticCurveTo(gx,gy,gx+3,gy);
  cx.closePath(); cx.fill();

  // Fabric weave — horizontal cloth lines
  cx.save();
  cx.beginPath();
  cx.moveTo(gx+3,gy); cx.lineTo(gx+gw-3,gy);
  cx.quadraticCurveTo(gx+gw,gy,gx+gw,gy+3);
  cx.lineTo(gx+gw,gy+gh-3); cx.quadraticCurveTo(gx+gw,gy+gh,gx+gw-3,gy+gh);
  cx.lineTo(gx+3,gy+gh); cx.quadraticCurveTo(gx,gy+gh,gx,gy+gh-3);
  cx.lineTo(gx,gy+3); cx.quadraticCurveTo(gx,gy,gx+3,gy);
  cx.closePath(); cx.clip();

  // Cloth texture — tight horizontal ribs
  for(let fy2=gy+1;fy2<gy+gh;fy2+=2){
    cx.fillStyle=fy2%4<2?'rgba(40,22,10,.55)':'rgba(20,10,4,.38)';
    cx.fillRect(gx,fy2,gw,1);
  }
  // Vertical warp threads (subtle)
  for(let fx2=gx+2;fx2<gx+gw-2;fx2+=4){
    cx.fillStyle='rgba(60,35,15,.18)';
    cx.fillRect(fx2,gy,1,gh);
  }

  // Speaker cone — central circle visible through grille
  const coneX=gx+gw*.48, coneY=gy+gh*.52;
  for(let cr=2;cr<14;cr+=2.8){
    const ca=.22-cr*.01;
    cx.strokeStyle=`rgba(80,50,20,${ca})`;
    cx.lineWidth=.7;
    cx.beginPath(); cx.ellipse(coneX,coneY,cr,cr*.72,0,0,Math.PI*2); cx.stroke();
  }
  // Centre dustcap
  cx.fillStyle='rgba(100,65,30,.55)';
  cx.beginPath(); cx.ellipse(coneX,coneY,2.5,1.8,0,0,Math.PI*2); cx.fill();

  // Active speaker shimmer — warm pulsing glow through cloth when on
  if(S.radioOn){
    const pulse=.5+.5*Math.sin(S.t*8.5);
    cx.fillStyle=`rgba(255,160,60,${.06+.05*pulse})`;
    cx.fillRect(gx,gy,gw,gh);
  }
  cx.restore();

  // Grille border trim — thin chrome strip
  cx.strokeStyle='rgba(180,140,80,.35)'; cx.lineWidth=.8;
  cx.beginPath();
  cx.moveTo(gx+3,gy); cx.lineTo(gx+gw-3,gy);
  cx.quadraticCurveTo(gx+gw,gy,gx+gw,gy+3);
  cx.lineTo(gx+gw,gy+gh-3); cx.quadraticCurveTo(gx+gw,gy+gh,gx+gw-3,gy+gh);
  cx.lineTo(gx+3,gy+gh); cx.quadraticCurveTo(gx,gy+gh,gx,gy+gh-3);
  cx.lineTo(gx,gy+3); cx.quadraticCurveTo(gx,gy,gx+3,gy);
  cx.closePath(); cx.stroke();
  cx.lineWidth=1;

  // ── Tuner dial window — amber CRT glass ──────────
  const tx=x+68, ty=y+6, tw=32, th=14;
  // Glass housing (recessed dark frame)
  cx.fillStyle='rgba(10,6,4,.9)'; rr(cx,tx-2,ty-2,tw+4,th+4,3,true,false);
  // Amber glass face
  const dialG=cx.createLinearGradient(tx,ty,tx,ty+th);
  dialG.addColorStop(0,'rgba(80,45,5,.92)');
  dialG.addColorStop(.5,'rgba(55,30,4,.88)');
  dialG.addColorStop(1,'rgba(30,15,2,.95)');
  cx.fillStyle=dialG; rr(cx,tx,ty,tw,th,2,true,false);

  // Frequency scale markings
  const freqLabels=[6,8,10,12,15];
  freqLabels.forEach((f,i)=>{
    const fx3=tx+2+i*(tw-4)/4;
    const major=i===0||i===4;
    cx.fillStyle=`rgba(200,140,40,${major?.65:.38})`;
    cx.fillRect(fx3,ty+1,1,major?5:3);
  });
  // Minor ticks between labels
  for(let i=0;i<16;i++){
    const fx3=tx+2+i*((tw-4)/16);
    cx.fillStyle='rgba(150,90,20,.22)';
    cx.fillRect(fx3,ty+1,1,2);
  }

  // Frequency band strip — warm amber glow
  const bandG=cx.createLinearGradient(tx,ty+5,tx+tw,ty+5);
  bandG.addColorStop(0,'rgba(255,100,10,.18)');
  bandG.addColorStop(.35,'rgba(255,180,60,.22)');
  bandG.addColorStop(.65,'rgba(255,200,80,.20)');
  bandG.addColorStop(1,'rgba(255,100,10,.16)');
  cx.fillStyle=bandG; cx.fillRect(tx+1,ty+5,tw-2,5);

  // Needle — thin red line tracks S.radioTune
  const needleX=tx+2+S.radioTune*(tw-4);
  cx.fillStyle='rgba(255,60,40,.95)'; cx.fillRect(needleX,ty+1,1,th-2);
  cx.fillStyle='rgba(255,200,180,.6)'; cx.fillRect(needleX,ty+1,1,2);

  // Glass glare on dial
  const dg=cx.createLinearGradient(tx,ty,tx+tw*.6,ty+th*.5);
  dg.addColorStop(0,'rgba(255,220,160,.12)'); dg.addColorStop(1,'transparent');
  cx.fillStyle=dg; rr(cx,tx,ty,tw,th,2,true,false);

  // Static noise in dial glass when between stations
  if(S.radioOn && S.radioStatic>.04){
    cx.save();
    cx.beginPath(); rr(cx,tx,ty,tw,th,2,false,false); cx.clip();
    cx.globalAlpha=clamp(S.radioStatic*.8,.0,.5);
    for(let i=0;i<12;i++){
      const sx=tx+1+Math.random()*(tw-2);
      const sy=ty+1+Math.random()*(th-2);
      cx.fillStyle=i%3?'rgba(255,180,60,.7)':'rgba(255,255,200,.5)';
      cx.fillRect(sx,sy,1+Math.random()*3,.8);
    }
    cx.restore();
  }

  // ── Knobs — two large Bakelite dials ─────────────
  [[x+71,y+h-8,'vol'],[x+88,y+h-8,'tune']].forEach(([kx,ky,type],i)=>{
    // Outer ring — ridged chrome
    cx.strokeStyle='rgba(160,120,60,.45)'; cx.lineWidth=1.5;
    cx.beginPath(); cx.arc(kx,ky,8,0,Math.PI*2); cx.stroke();
    // Body
    const kg=cx.createRadialGradient(kx-2,ky-2,1,kx,ky,8);
    kg.addColorStop(0,'#4a3018'); kg.addColorStop(.5,'#2e1c0a'); kg.addColorStop(1,'#1a0e04');
    cx.fillStyle=kg; cx.beginPath(); cx.arc(kx,ky,7,0,Math.PI*2); cx.fill();
    // Knob highlight
    cx.fillStyle='rgba(255,200,130,.18)';
    cx.beginPath(); cx.arc(kx-2,ky-2,2.2,0,Math.PI*2); cx.fill();
    // Pointer line
    const ang=type==='vol'
      ? (-Math.PI*.75+S.radioVol*Math.PI*1.5)
      : (-Math.PI*.82+S.radioTune*.72);
    cx.strokeStyle='rgba(255,220,160,.8)'; cx.lineWidth=1;
    cx.beginPath();
    cx.moveTo(kx,ky);
    cx.lineTo(kx+Math.cos(ang)*5.5,ky+Math.sin(ang)*5.5);
    cx.stroke();
    cx.lineWidth=1;
  });

  // ── Antenna — telescoping chrome, right-rear ──────
  const aBase={x:x+w-8,y:y+4};
  cx.strokeStyle='rgba(90,70,40,.8)'; cx.lineWidth=2.2;
  cx.beginPath(); cx.moveTo(aBase.x,aBase.y); cx.lineTo(aBase.x+3,aBase.y-18); cx.stroke();
  cx.strokeStyle='rgba(140,110,60,.65)'; cx.lineWidth=1.4;
  cx.beginPath(); cx.moveTo(aBase.x+3,aBase.y-18); cx.lineTo(aBase.x+5,aBase.y-34); cx.stroke();
  cx.strokeStyle='rgba(190,160,100,.45)'; cx.lineWidth=.8;
  cx.beginPath(); cx.moveTo(aBase.x+5,aBase.y-34); cx.lineTo(aBase.x+7,aBase.y-46); cx.stroke();
  // Hinge knuckle at base
  cx.fillStyle='rgba(110,80,35,.7)';
  cx.beginPath(); cx.arc(aBase.x,aBase.y,2.2,0,Math.PI*2); cx.fill();
  cx.lineWidth=1;

  // ── Power LED ─────────────────────────────────────
  cx.fillStyle=S.radioOn?'#ff9020':'#2a1400';
  cx.beginPath(); cx.arc(x+w-14,y+h-10,2.5,0,Math.PI*2); cx.fill();
  if(S.radioOn){
    cx.fillStyle=`rgba(255,140,30,.28)`;
    cx.beginPath(); cx.arc(x+w-14,y+h-10,6,0,Math.PI*2); cx.fill();
  }

  // ── Focus ring ────────────────────────────────────
  if(S.focus==='radio'){
    cx.strokeStyle='rgba(255,180,255,.5)'; cx.lineWidth=1.5;
    rr(cx,x-2,y-6,w+4,h+10,10,false,true); cx.lineWidth=1;
  }
}

// -- TV ------------------------------------------------
// Native HUSH TV asset integration.
// Uses the new transparent cut-out TV asset, with the live canvas TV system
// composited into the glass rather than placing a rectangular image over the room.
const HUSH_TV_ASSET_SRC='assets/hush-tv-asset.png';
const HUSH_TV_IMG=new Image();
HUSH_TV_IMG.src=HUSH_TV_ASSET_SRC;

// ── ANIME CHANNEL VIDEO ────────────────────────────────
const TV_ANIME=document.createElement('video');
TV_ANIME.src='assets/Bop.mp4';
TV_ANIME.loop=true;
TV_ANIME.muted=true;
TV_ANIME.playsInline=true;
TV_ANIME.preload='auto';

function syncAnimeVideo(){
  if(S.tvOn && S.tvCh===3){
    if(TV_ANIME.paused) TV_ANIME.play().catch(()=>{});
  } else {
    if(!TV_ANIME.paused) TV_ANIME.pause();
  }
}

function drawTV(){
  const base=R.tv;

  const x=base.x-34;
  const y=base.y-18;
  const w=base.w+72;
  const h=base.h+36;

  // Screen bounds measured directly from hush-tv-asset.png (2048x1365).
  // PNG has solid black background (no alpha), so draw order is: shell first, screen content second.
  const sx=x+w*.226;
  const sy=y+h*.227;
  const sw=w*.354;
  const sh=h*.440;
  const sr=Math.max(4,w*.030);

  const day=S.timeBlend.day||0;
  const sunset=S.timeBlend.sunset||0;
  const night=S.timeBlend.night||0;

  // Object-only filter so the shell responds to time of day without needing
  // separate day/sunset/night assets.
  const shellBrightness=(1.06*day)+(1.015*sunset)+(.96*night);
  const shellSaturation=(.82*day)+(1.02*sunset)+(1.08*night);
  const shellContrast=(.96*day)+(1.00*sunset)+(1.03*night);

  cx.save();

  // Tiny perspective skew only. No rotation, no slab glow.
  const cx0=x+w*.52, cy0=y+h*.60;
  cx.translate(cx0,cy0);
  cx.transform(1,.010,-.020,1,0,0);
  cx.translate(-cx0,-cy0);

  // Hard contact shadow. Tight and low, so it anchors the feet/base without
  // creating a visible blur block.
  cx.save();
  cx.globalAlpha=.36;
  cx.filter='blur(1.2px)';
  cx.fillStyle='rgba(0,0,0,.72)';
  cx.beginPath();
  cx.ellipse(x+w*.55,y+h*.895,w*.34,h*.035,0,0,Math.PI*2);
  cx.fill();

  // Soft shadow falloff. Kept lower and darker than previous versions.
  cx.globalAlpha=.13;
  cx.filter='blur(8px)';
  cx.fillStyle='rgba(0,0,0,.85)';
  cx.beginPath();
  cx.ellipse(x+w*.56,y+h*.907,w*.44,h*.060,0,0,Math.PI*2);
  cx.fill();
  cx.restore();

  // 1. Draw TV shell FIRST (PNG has solid black background — must come before screen content)
  if(HUSH_TV_IMG.complete && HUSH_TV_IMG.naturalWidth){
    cx.save();
    cx.globalAlpha=.985;
    cx.filter=`brightness(${shellBrightness.toFixed(3)}) saturate(${shellSaturation.toFixed(3)}) contrast(${shellContrast.toFixed(3)})`;
    cx.drawImage(HUSH_TV_IMG,x,y,w,h);
    cx.restore();
  } else {
    const g=cx.createLinearGradient(x,y,x,y+h);
    g.addColorStop(0,'#171324');
    g.addColorStop(1,'#07070c');
    cx.fillStyle=g;
    rr(cx,x,y,w,h,9,true,false);
  }

  // 2. Screen content drawn ON TOP of shell, clipped to a perspective trapezoid.
  // The TV's 3/4 angle means the right edge recedes — lean approximates this.
  cx.save();
  const lean=sh*.055;
  cx.beginPath();
  cx.moveTo(sx,    sy);
  cx.lineTo(sx+sw, sy+lean);
  cx.lineTo(sx+sw, sy+sh+lean);
  cx.lineTo(sx,    sy+sh);
  cx.closePath();
  cx.clip();

  // Shear maps rectangular content onto the angled screen, pivoting at top-left.
  const shearB=lean/sw;
  cx.transform(1,shearB,0,1,0,-shearB*sx);

  if(S.tvOn){
    drawTVScreen(sx,sy,sw,sh);
  }else{
    const off=cx.createLinearGradient(sx,sy,sx,sy+sh);
    off.addColorStop(0,'rgba(4,5,10,.58)');
    off.addColorStop(1,'rgba(0,0,0,.76)');
    cx.fillStyle=off;
    cx.fillRect(sx,sy,sw,sh);
  }

  // Inner glass shadow. This remains useful once video channels are added.
  const inner=cx.createLinearGradient(sx,sy,sx,sy+sh);
  inner.addColorStop(0,'rgba(0,0,0,.42)');
  inner.addColorStop(.18,'rgba(0,0,0,.14)');
  inner.addColorStop(.72,'rgba(0,0,0,.03)');
  inner.addColorStop(1,'rgba(0,0,0,.30)');
  cx.fillStyle=inner;
  cx.fillRect(sx,sy,sw,sh);

  // Slight left-side glass bloom, deliberately subtle so it does not fight
  // future anime/music video content.
  const glass=cx.createRadialGradient(sx+sw*.20,sy+sh*.40,0,sx+sw*.24,sy+sh*.42,sw*.62);
  glass.addColorStop(0,`rgba(${120+70*sunset|0},${80+20*day|0},${190+30*night|0},${.075+.035*night})`);
  glass.addColorStop(.48,'rgba(70,150,255,.026)');
  glass.addColorStop(1,'rgba(0,0,0,0)');
  cx.fillStyle=glass;
  cx.fillRect(sx,sy,sw,sh);

  // Reduced scanlines: texture only, not visible UI.
  cx.fillStyle='rgba(0,0,0,.038)';
  for(let yy=sy+1; yy<sy+sh; yy+=4) cx.fillRect(sx,yy,sw,1);
  cx.restore();

  // Screen edge highlight and glass lip.

  cx.save();
  cx.globalAlpha=S.tvOn?.17:.09;
  cx.strokeStyle=night>.5?'rgba(150,220,255,.48)':sunset>.5?'rgba(255,150,210,.40)':'rgba(220,230,255,.30)';
  cx.lineWidth=.75;
  rr(cx,sx+1,sy+1,sw-2,sh-2,sr,false,true);
  cx.restore();

  // Tiny emissive bleed. This changes with time of day but never forms a box.
  if(S.tvOn){
    cx.save();
    cx.globalCompositeOperation='screen';
    const spill=cx.createRadialGradient(sx+sw*.52,sy+sh*.54,0,sx+sw*.52,sy+sh*.54,w*.46);
    spill.addColorStop(0, night>.45?'rgba(80,150,255,.042)':sunset>.45?'rgba(255,95,190,.032)':'rgba(170,190,255,.022)');
    spill.addColorStop(.42,'rgba(150,70,255,.014)');
    spill.addColorStop(1,'rgba(0,0,0,0)');
    cx.fillStyle=spill;
    cx.fillRect(x+w*.02,y+h*.10,w*.78,h*.74);
    cx.restore();
  }

  // Clock display moved so it reads as a wall/window controller, not a sticker
  // sitting on top of the TV shell.
  const clockOn=S.hover==='clock'||document.getElementById('timeUi').classList.contains('show');
  const ckx=base.x+34, cky=base.y-24, ckw=60, ckh=14;
  const ckg=cx.createLinearGradient(ckx,cky,ckx,cky+ckh);
  ckg.addColorStop(0,clockOn?'#1a2a38':'#141820');
  ckg.addColorStop(1,clockOn?'#0e1c28':'#0c1018');
  cx.fillStyle=ckg; rr(cx,ckx,cky,ckw,ckh,3,true,false);
  cx.strokeStyle=clockOn?'rgba(141,224,255,.65)':'rgba(100,160,220,.20)';
  cx.lineWidth=.8; rr(cx,ckx,cky,ckw,ckh,3,false,true); cx.lineWidth=1;
  cx.fillStyle=clockOn?'#d0f4ff':'#7ec8e8';
  cx.font='bold 10px monospace';
  cx.fillText(document.getElementById('clkTxt').textContent,ckx+5,cky+10);
  if(clockOn){
    cx.fillStyle='rgba(80,200,255,.10)';
    cx.fillRect(ckx+2,cky+2,ckw-4,ckh-4);
  }
  cx.font='5px monospace';
  cx.fillStyle='rgba(180,220,255,.30)';
  cx.fillText('TIME',ckx+ckw+2,cky+9);

  // Floor reflection
  cx.save();
  cx.globalAlpha=S.tvOn?.07:.03;
  cx.transform(1,0,0,-1,0,(y+h*.96)*2);
  cx.filter='blur(2px)';
  if(HUSH_TV_IMG.complete&&HUSH_TV_IMG.naturalWidth) cx.drawImage(HUSH_TV_IMG,x,y,w,h);
  cx.restore();

  // Floor glow puddle
  if(S.tvOn){
    cx.save();
    cx.globalAlpha=.09+S.tvBloom*.06;
    const puddle=cx.createRadialGradient(x+w*.52,y+h*.97,0,x+w*.52,y+h*.97,w*.42);
    puddle.addColorStop(0,'rgba(100,180,255,.4)');
    puddle.addColorStop(.5,'rgba(80,120,220,.15)');
    puddle.addColorStop(1,'transparent');
    cx.fillStyle=puddle;
    cx.beginPath();
    cx.ellipse(x+w*.52,y+h*.97,w*.42,h*.09,0,0,Math.PI*2);
    cx.fill();
    cx.restore();
  }

  if(S.focus==='tv'){
    cx.strokeStyle='rgba(130,230,255,.38)';
    cx.lineWidth=1.1;
    rr(cx,x-2,y-2,w+4,h+6,10,false,true);
    cx.lineWidth=1;
  }

  cx.restore();
}

function drawTVScreen(x,y,w,h){
  if(!S.tvOn){
    cx.fillStyle='#080a0c'; rr(cx,x,y,w,h,4,true,false);
    if(S.tvFlicker<=0) return;
  }
  if(S.tvOn && S.tvCh===0){
    // Slow plasma / colour-field ambient — no hard cuts, all sinusoidal drift
    const t=S.t;
    cx.save(); cx.beginPath(); rr(cx,x,y,w,h,4,false,false); cx.clip();
    // Base dark field
    cx.fillStyle='#050308'; cx.fillRect(x,y,w,h);
    // Layered colour blobs — each is a soft radial
    const blobs=[
      {cx2:x+w*(.38+.28*Math.sin(t*.14)), cy:y+h*(.45+.28*Math.cos(t*.11)), r:w*.52, col:`rgba(${60+40*Math.sin(t*.2)|0},10,${120+80*Math.cos(t*.15)|0},`},
      {cx2:x+w*(.62+.22*Math.cos(t*.17)), cy:y+h*(.38+.24*Math.sin(t*.13)), r:w*.42, col:`rgba(10,${80+60*Math.sin(t*.19)|0},${140+80*Math.cos(t*.12)|0},`},
      {cx2:x+w*(.50+.18*Math.sin(t*.22+1)), cy:y+h*(.55+.20*Math.cos(t*.18+2)), r:w*.36, col:`rgba(${100+80*Math.cos(t*.16)|0},20,${80+60*Math.sin(t*.21)|0},`},
    ];
    cx.globalCompositeOperation='screen';
    blobs.forEach(b=>{
      const g=cx.createRadialGradient(b.cx2,b.cy,0,b.cx2,b.cy,b.r);
      g.addColorStop(0,b.col+'.28)');
      g.addColorStop(.5,b.col+'.10)');
      g.addColorStop(1,'transparent');
      cx.fillStyle=g; cx.fillRect(x,y,w,h);
    });
    cx.globalCompositeOperation='source-over';
    // Slow horizontal scan gradient
    const sy2=y+((t*4.5)%h);
    const sg=cx.createLinearGradient(x,sy2-4,x,sy2+4);
    sg.addColorStop(0,'transparent'); sg.addColorStop(.5,'rgba(200,180,255,.055)'); sg.addColorStop(1,'transparent');
    cx.fillStyle=sg; cx.fillRect(x,sy2-4,w,8);
    cx.restore();
  } else if(S.tvOn && S.tvCh===1){
    // City cam
    cx.fillStyle='#080e18'; rr(cx,x,y,w,h,4,true,false);
    for(let i=0;i<7;i++){
      const bh=4+Math.floor((Math.sin(S.t*1.1+i)*.5+.5)*18);
      const bx=x+i*(w/7);
      cx.fillStyle='#16233a'; cx.fillRect(bx,y+h-bh,w/7-1,bh);
      if(Math.sin(S.t*2+i)>.2){
        cx.fillStyle=i%2?'#ff9de0':'#8adaff';
        cx.fillRect(bx+2,y+h-bh+2,3,3);
      }
    }
    // Scan line
    const sc=((S.t*30)%(h+2));
    cx.fillStyle='rgba(255,255,255,.15)'; cx.fillRect(x,y+sc,w,1);
  } else if(S.tvOn && S.tvCh===2) {
    // Glitch
    cx.fillStyle='#0c0710'; rr(cx,x,y,w,h,4,true,false);
    for(let i=0;i<8;i++){
      const c1=Math.random()*180+60|0;
      cx.fillStyle=`rgba(${c1},${Math.random()*40|0},${120+Math.random()*120|0},.9)`;
      cx.fillRect(x,(y+Math.random()*h)|0,w,1+(Math.random()*3|0));
    }
  } else if(S.tvOn && S.tvCh===3){
    // Anime channel — draws live video frames onto the screen
    if(TV_ANIME.readyState>=2){
      cx.drawImage(TV_ANIME,x,y,w,h);
    } else {
      // Not loaded yet — show a subtle loading state
      cx.fillStyle='#08040f';
      cx.fillRect(x,y,w,h);
      cx.fillStyle='rgba(200,140,255,.5)';
      cx.font=`${Math.max(4,h*.11)|0}px monospace`;
      cx.textAlign='center';
      cx.fillText('LOADING',x+w*.5,y+h*.54);
      cx.textAlign='left';
    }
  }

  // Scanlines overlay
  for(let yy=y+2;yy<y+h;yy+=3){
    cx.fillStyle='rgba(0,0,0,.12)'; cx.fillRect(x,yy,w,1);
  }
  // Physical CRT power/channel flicker and bloom.
  if(S.tvFlicker>0){
    const f=clamp(S.tvFlicker,0,1);
    cx.save();
    cx.beginPath(); rr(cx,x,y,w,h,4,false,false); cx.clip();
    if(Math.sin(S.t*42)>-.2){
      cx.fillStyle=`rgba(255,255,255,${.08*f})`;
      cx.fillRect(x,y,w,h);
    }
    for(let i=0;i<5;i++){
      const yy=y+((S.t*95+i*13)%h);
      cx.fillStyle=i%2?`rgba(120,220,255,${.18*f})`:`rgba(255,90,190,${.14*f})`;
      cx.fillRect(x,yy,w,1+Math.random()*2);
    }
    if(!S.tvOn){
      const close=clamp(S.tvFlicker/.75,0,1);
      cx.fillStyle=`rgba(0,0,0,${.65*(1-close)})`;
      cx.fillRect(x,y,w,h);
      cx.fillStyle=`rgba(255,255,255,${.25*close})`;
      cx.fillRect(x,y+h*.5-1,w,2);
    }
    cx.restore();
  }
  if(S.tvBloom>0){
    const b=clamp(S.tvBloom,0,1);
    const bloom=cx.createRadialGradient(x+w*.45,y+h*.42,0,x+w*.45,y+h*.42,w*.82);
    bloom.addColorStop(0,`rgba(140,220,255,${.12*b})`);
    bloom.addColorStop(.45,`rgba(255,100,210,${.055*b})`);
    bloom.addColorStop(1,'transparent');
    cx.fillStyle=bloom; cx.fillRect(x-10,y-10,w+20,h+20);
  }

  // Screen glare
  const gg=cx.createLinearGradient(x,y,x+16,y+14);
  gg.addColorStop(0,'rgba(255,255,255,.14)'); gg.addColorStop(1,'transparent');
  cx.fillStyle=gg; cx.fillRect(x+3,y+3,18,14);
}

// ── AQUARIUM ─────────────────────────────────────────

function drawHoloCube(){
  const {x,y,w,h}=R.holo;
  const bob=Math.sin(S.t*1.6)*3;
  const yy=y+bob;
  if(S.holoPulse>0) S.holoPulse=Math.max(0,S.holoPulse-0.025);
  const sh=cx.createRadialGradient(x,y+20,4,x,y+20,42+S.holoPulse*26);
  sh.addColorStop(0,`rgba(150,95,255,${.16+S.holoPulse*.18})`);
  sh.addColorStop(1,'transparent');
  cx.fillStyle=sh; cx.fillRect(x-58,y-8,116,56);
  const bg=cx.createLinearGradient(x-20,y+10,x+20,y+28);
  bg.addColorStop(0,'#1b1424'); bg.addColorStop(1,'#0e0a15');
  cx.fillStyle=bg; rr(cx,x-22,y+8,44,22,7,true,false);
  cx.fillStyle=`rgba(185,150,255,${.45+S.holoPulse*.25})`;
  cx.beginPath(); cx.arc(x, y+16, 6, 0, Math.PI*2); cx.fill();
  cx.save();
  cx.translate(x, yy-16);
  cx.globalCompositeOperation='lighter';
  const alpha=.55+Math.sin(S.t*2.2)*.12+S.holoPulse*.25;
  cx.strokeStyle=`rgba(170,145,255,${alpha})`;
  cx.fillStyle=`rgba(200,185,255,${.10+S.holoPulse*.08})`;
  cx.lineWidth=1.3+S.holoPulse*.7;
  if(S.holoMode===0){
    const rot=S.t*.7;
    const s2=17+S.holoPulse*5;
    const pts=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(([px,py,pz])=>{
      const cr=Math.cos(rot), sr=Math.sin(rot);
      const rx=px*cr-pz*sr, rz=px*sr+pz*cr;
      const scale=1/(1+rz*.22);
      return {x:rx*s2*scale, y:py*s2*.72*scale, z:rz};
    });
    [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]].forEach(([a,b])=>{cx.beginPath();cx.moveTo(pts[a].x,pts[a].y);cx.lineTo(pts[b].x,pts[b].y);cx.stroke();});
    cx.beginPath();cx.moveTo(pts[0].x,pts[0].y);cx.lineTo(pts[1].x,pts[1].y);cx.lineTo(pts[2].x,pts[2].y);cx.lineTo(pts[3].x,pts[3].y);cx.closePath();cx.fill();
  } else if(S.holoMode===1){
    for(let i=0;i<4;i++){
      cx.save(); cx.rotate(S.t*.45+i*.75);
      cx.beginPath(); cx.ellipse(0,0,24-i*3,8+i*2,0,0,Math.PI*2); cx.stroke();
      cx.restore();
    }
    cx.beginPath(); cx.arc(0,0,8+Math.sin(S.t*2)*2,0,Math.PI*2); cx.fill();
  } else if(S.holoMode===2){
    for(let i=-3;i<=3;i++){
      const bh=12+Math.sin(S.t*2.5+i)*8+S.holoPulse*8;
      rr(cx,i*7-2,-bh/2,4,bh,2,true,true);
    }
  } else {
    // Mode 3: DNA double helix
    const turns=2.8, strands=28;
    for(let s=0;s<2;s++){
      const phaseOff=s*Math.PI;
      cx.beginPath();
      for(let i=0;i<=strands;i++){
        const t2=i/strands;
        const angle=t2*turns*Math.PI*2+S.t*.9+phaseOff;
        const px=Math.cos(angle)*18;
        const py=(t2-.5)*52;
        if(i===0) cx.moveTo(px,py); else cx.lineTo(px,py);
      }
      cx.strokeStyle=s===0?`rgba(120,200,255,${alpha})`:`rgba(255,120,200,${alpha})`;
      cx.lineWidth=1.4+S.holoPulse*.5;
      cx.stroke();
    }
    // Rungs connecting the two strands
    for(let i=0;i<strands;i+=2){
      const t2=i/strands;
      const angle=t2*turns*Math.PI*2+S.t*.9;
      const px0=Math.cos(angle)*18, py=(t2-.5)*52;
      const px1=Math.cos(angle+Math.PI)*18;
      cx.strokeStyle=`rgba(200,200,255,${alpha*.45})`;
      cx.lineWidth=.7;
      cx.beginPath(); cx.moveTo(px0,py); cx.lineTo(px1,py); cx.stroke();
    }
    cx.lineWidth=1;
  }
  cx.restore();
  const beam=cx.createLinearGradient(x, y+8, x, yy-38);
  beam.addColorStop(0,`rgba(150,120,255,${.14+S.holoPulse*.10})`);
  beam.addColorStop(1,'transparent');
  cx.fillStyle=beam;
  cx.beginPath(); cx.moveTo(x-9,y+10); cx.lineTo(x+9,y+10); cx.lineTo(x+24,yy-38); cx.lineTo(x-24,yy-38); cx.closePath(); cx.fill();
  if(S.hover&&S.hover.id==='holo'){
    cx.strokeStyle='rgba(200,180,255,.42)'; cx.lineWidth=1.2;
    rr(cx,x-27,y-38,54,66,8,false,true); cx.lineWidth=1;
  }
}

// ── DUST MOTES ───────────────────────────────────────
function drawDust(){
  dust.forEach(d=>{
    d.x+=d.vx+Math.sin(S.t*.2+d.ph)*.06;
    d.y+=d.vy+Math.cos(S.t*.15+d.ph)*.04;
    if(d.y<R.lamp.y-90){d.y=R.lamp.y+20;d.x=R.lamp.x+(Math.random()-.5)*80;}
    const dist=Math.hypot(d.x-R.lamp.x,d.y-R.lamp.y);
    if(dist<100){
      cx.fillStyle=`rgba(255,220,180,${d.a*(1-dist/100)})`;
      cx.fillRect(d.x,d.y,1.5,1.5);
    }
  });
}

// ── HUSH OS v0.35 NEXT-LEVEL CINEMATIC PASS ───────────────────
function updateCinematicEvents(dt){
  S.trainT=(S.trainT+dt*.030)%1;

  if(S.helicopterActive>0){
    S.helicopterT+=dt*(S.helicopterSpeed||.20);
    if(S.helicopterT>=1.08){
      S.helicopterActive=0;
      S.helicopterT=-1;
    }
  }

  if(S.rainGust>0) S.rainGust=Math.max(0,S.rainGust-dt*.32);

  const storm=!!S.weather?.thunderstorm;
  if(S.lightning>0) S.lightning=Math.max(0,S.lightning-dt*(storm?1.25:1.9));
  if(S.thunderPulse>0) S.thunderPulse=Math.max(0,S.thunderPulse-dt*(storm?.34:.55));
  S.stormWind = storm ? (.55 + Math.sin(S.t*.31)*.22 + Math.sin(S.t*1.7)*.12) : Math.max(0,(S.stormWind||0)-dt*.7);
}

function drawWindowLifeEvents(){
  const {x,y,w,h}=R.win;
  cx.save(); cx.beginPath(); cx.rect(x,y,w,h); cx.clip(); cx.globalCompositeOperation='lighter';
  const railY=y+h*.66;
  const trainX=x-92+S.trainT*(w+184);
  const trainGlow=cx.createLinearGradient(trainX,railY,trainX+116,railY);
  trainGlow.addColorStop(0,'transparent'); trainGlow.addColorStop(.24,'rgba(90,220,255,.32)'); trainGlow.addColorStop(.56,'rgba(255,120,220,.30)'); trainGlow.addColorStop(1,'transparent');
  cx.fillStyle=trainGlow; rr(cx,trainX,railY,108,5,3,true,false);
  for(let i=0;i<8;i++){ cx.fillStyle=i%2?'rgba(255,220,155,.65)':'rgba(145,230,255,.65)'; cx.fillRect(trainX+12+i*11,railY+1.2,3,1.8); }
  const hx=x-34+S.helicopterT*(w+70);
  const hy=y+h*((S.helicopterY||.22)+.035*Math.sin(S.t*.7));
  cx.globalAlpha=.70; cx.fillStyle='rgba(4,3,9,.78)'; rr(cx,hx,hy,18,4,2,true,false); cx.fillRect(hx+6,hy-5,2,5);
  cx.strokeStyle='rgba(170,230,255,.12)'; cx.lineWidth=1; cx.beginPath(); cx.moveTo(hx-16,hy-2); cx.lineTo(hx+34,hy-2); cx.stroke();
  if(Math.sin(S.t*8)>0.45){ cx.globalAlpha=.9; cx.fillStyle='rgba(255,80,120,.8)'; cx.fillRect(hx+20,hy,2,2); }
  cx.globalCompositeOperation='source-over'; cx.globalAlpha=1;
  for(let i=0;i<4;i++){ const yy=y+h*(.30+i*.12)+Math.sin(S.t*.08+i)*2; const fg=cx.createLinearGradient(x,yy,x+w,yy+18); fg.addColorStop(0,'transparent'); fg.addColorStop(.5,'rgba(170,160,220,'+(.030+i*.006)+')'); fg.addColorStop(1,'transparent'); cx.fillStyle=fg; cx.fillRect(x,yy,w,22); }
  cx.restore();
}

function drawLeanOutLifeEvents(){
  const a=clamp(S.leanAnim||0,0,1); if(a<=.01) return;
  const ease=a*a*(3-2*a), lookX=clamp(S.mx||0,-1,1), lookY=clamp(S.my||0,-1,1), lookDown=clamp((lookY+.08)/.92,0,1);
  const horizon=lerp(H*.52,H*.18,lookDown);
  cx.save(); cx.globalAlpha=ease; cx.globalCompositeOperation='lighter';
  const railY=horizon+65+lookDown*68;
  const trainX=-130+S.trainT*(W+260)+lookX*32;
  const tg=cx.createLinearGradient(trainX,railY,trainX+150,railY);
  tg.addColorStop(0,'transparent'); tg.addColorStop(.28,'rgba(80,220,255,.38)'); tg.addColorStop(.58,'rgba(255,80,210,.34)'); tg.addColorStop(1,'transparent');
  cx.fillStyle=tg; rr(cx,trainX,railY,140,6,4,true,false);
  for(let i=0;i<11;i++){ cx.fillStyle=i%2?'rgba(255,225,160,.72)':'rgba(135,230,255,.70)'; cx.fillRect(trainX+14+i*11,railY+1,3,2); }
  const hx=-70+S.helicopterT*(W+140)+lookX*46, hy=H*(S.helicopterY||.16)+Math.sin(S.t*.75)*8+lookDown*12;
  cx.fillStyle='rgba(4,3,9,.86)'; rr(cx,hx,hy,24,5,2,true,false); cx.fillRect(hx+9,hy-7,3,7);
  cx.strokeStyle='rgba(180,230,255,.16)'; cx.lineWidth=1; cx.beginPath(); cx.moveTo(hx-22,hy-2); cx.lineTo(hx+45,hy-2); cx.stroke();
  if(Math.sin(S.t*8)>0.45){cx.fillStyle='rgba(255,70,115,.85)'; cx.fillRect(hx+28,hy,2,2);}
  const sg=cx.createRadialGradient(hx+12,hy+6,0,hx+12,hy+70,110); sg.addColorStop(0,'rgba(170,220,255,.035)'); sg.addColorStop(1,'transparent'); cx.fillStyle=sg; cx.fillRect(hx-120,hy,W*.7,150);
  if(lookDown>.18){ const streetTop=lerp(H*.88,H*.30,lookDown); cx.globalAlpha=ease*clamp((lookDown-.18)/.82,0,1); for(let i=0;i<10;i++){ const px=((i*73+S.t*(38+i*3))%W); const py=streetTop+40+((i*41)%(Math.max(40,H-streetTop-50))); const len=28+(i%5)*9; const gr=cx.createLinearGradient(px,py,px-len,py+3); gr.addColorStop(0,i%2?'rgba(255,205,120,.55)':'rgba(120,220,255,.55)'); gr.addColorStop(1,'transparent'); cx.strokeStyle=gr; cx.lineWidth=1.2; cx.beginPath(); cx.moveTo(px,py); cx.lineTo(px-len,py+3); cx.stroke(); } }
  cx.restore();
}

function drawRainLayering(){
  if(!(S.weather.rain || S.weather.thunderstorm)) return;
  const {x,y,w,h}=R.win;
  const tp=timeProfile();
  const storm=!!S.weather.thunderstorm;
  const day=tp.day||0;
  const sunset=tp.sunset||0;
  const gust=Math.sin(S.rainGust*Math.PI);
  const open=clamp(S.winAnim||0,0,1);

  if(day>.02){
    cx.save(); cx.beginPath(); cx.rect(x,y,w,h); cx.clip();
    cx.globalCompositeOperation='multiply';
    cx.fillStyle=`rgba(120,125,128,${(.12*day + (storm?.06:0)).toFixed(3)})`;
    cx.fillRect(x,y,w,h);
    cx.restore();
  }

  cx.save(); cx.beginPath(); cx.rect(x,y,w,h); cx.clip(); cx.globalCompositeOperation='lighter';
  const baseCol = day>.25 ? [224,228,224] : (sunset>.25 ? [235,210,190] : [180,215,255]);
  const alphaBoost = day>.25 ? .022 : 0;
  for(let i=0;i<(storm?118:70);i++){
    const rx=x+((i*47+S.t*(38+i%9)*(.9+gust*.9+(storm?.9:0)))%w);
    const ry=y+((i*83+S.t*(86+i%7)*(.75+gust*.75+(storm?.55:0)))%h);
    const len=7+(i%7)*2+gust*8+(storm?10:0);
    const a=.032+(i%5)*.006+gust*.025+(storm?.030:0)+alphaBoost;
    cx.strokeStyle=`rgba(${baseCol[0]},${baseCol[1]},${baseCol[2]},${a.toFixed(3)})`;
    cx.lineWidth=day>.25?.65:.55;
    cx.beginPath(); cx.moveTo(rx,ry); cx.lineTo(rx-2-gust*3,ry+len); cx.stroke();
  }
  for(let i=0;i<30;i++){
    const rx=x+((i*61)%w)+Math.sin(S.t*.22+i)*2;
    const ry=y+((i*97+S.t*(14+i%6))%(h+42))-22;
    const len=18+(i%6)*7;
    const a=.060+(i%4)*.012+(day>.25?.018:0);
    cx.strokeStyle=`rgba(${day>.25?238:225},${day>.25?240:240},${day>.25?236:255},${a.toFixed(3)})`;
    cx.lineWidth=day>.25?.9:.8;
    cx.beginPath(); cx.moveTo(rx,ry); cx.quadraticCurveTo(rx+1.5,ry+len*.45,rx-2,ry+len); cx.stroke();
  }
  if(open>.05){
    const seamX=x+w*.5;
    const mist=cx.createRadialGradient(seamX,y+h*.58,0,seamX,y+h*.58,150);
    mist.addColorStop(0,'rgba(210,230,255,'+(.050*open+.030*gust)+')');
    mist.addColorStop(1,'transparent');
    cx.fillStyle=mist; cx.fillRect(x,y,w,h);
  }
  cx.restore();

  cx.save(); cx.beginPath(); cx.rect(x,y,w,h); cx.clip();
  cx.globalCompositeOperation='source-over';
  const dropSpd=storm?1.8:1.0;
  glassDroplets.forEach(d=>{
    d.y+=d.spd*dropSpd*.0014;
    if(d.y>1.12){ d.y=-.05; d.x=Math.random(); }
    const dx=x+d.x*w, dy=y+d.y*h;
    if(dy<y||dy>y+h) return;
    const trailH=d.trail*6+gust*4;
    const tg=cx.createLinearGradient(dx,dy-trailH,dx,dy);
    tg.addColorStop(0,'transparent');
    tg.addColorStop(1,`rgba(220,230,225,${(d.a*(day>.25?.68:.55)).toFixed(3)})`);
    cx.fillStyle=tg; cx.fillRect(dx-d.r*.3,dy-trailH,d.r*.6,trailH);
    cx.fillStyle=`rgba(230,238,235,${(d.a*(day>.25?.92:.82)).toFixed(3)})`;
    cx.beginPath(); cx.ellipse(dx,dy,d.r,d.r*1.3,0,0,Math.PI*2); cx.fill();
    cx.fillStyle=`rgba(255,255,255,${(d.a*.55).toFixed(3)})`;
    cx.beginPath(); cx.ellipse(dx-d.r*.25,dy-d.r*.3,d.r*.35,d.r*.3,-.4,0,Math.PI*2); cx.fill();
  });
  cx.restore();
}

function drawWindowInteriorReflections(){
  const {x,y,w,h}=R.win; cx.save(); cx.beginPath(); cx.rect(x,y,w,h); cx.clip(); cx.globalCompositeOperation='screen';
  const open=clamp(S.winAnim||0,0,1);
  let lg=cx.createRadialGradient(x+52,y+h*.72,0,x+52,y+h*.72,95); lg.addColorStop(0,'rgba(255,175,85,'+(S.lampOn?(0.060*(1-open*.45)*S.lampFlk):0)+')'); lg.addColorStop(1,'transparent'); cx.fillStyle=lg; cx.fillRect(x,y,w,h);
  if(S.tvOn){ const tv=cx.createRadialGradient(x+w-48,y+h*.58,0,x+w-48,y+h*.58,75); tv.addColorStop(0,'rgba(120,220,255,.038)'); tv.addColorStop(1,'transparent'); cx.fillStyle=tv; cx.fillRect(x,y,w,h); }
  const sweep=x+((S.t*.030)%1)*w; const sg=cx.createLinearGradient(sweep-30,y,sweep+30,y+h); sg.addColorStop(0,'transparent'); sg.addColorStop(.5,'rgba(235,245,255,.045)'); sg.addColorStop(1,'transparent'); cx.fillStyle=sg; cx.fillRect(sweep-36,y,72,h);
  cx.restore();

  // Window condensation/frost — appears when rain or snow active, fades when window is open
  const frostWeather=S.weather.rain||S.weather.thunderstorm||S.weather.snow;
  if(frostWeather){
    const frostA=clamp(.55-open*.8,0,.55);
    if(frostA>.005){
      cx.save(); cx.beginPath(); cx.rect(x,y,w,h); cx.clip();
      // Edge frost — stronger at corners
      const edges=[
        // bottom edge
        {g:cx.createLinearGradient(x,y+h-14,x,y+h), s:[[0,'transparent'],[1,`rgba(220,235,255,${frostA*.72})`]]},
        // left edge
        {g:cx.createLinearGradient(x,y,x+16,y), s:[[0,`rgba(220,235,255,${frostA*.5})`],[1,'transparent']]},
        // right edge
        {g:cx.createLinearGradient(x+w-16,y,x+w,y), s:[[0,'transparent'],[1,`rgba(220,235,255,${frostA*.5})`]]},
        // top edge
        {g:cx.createLinearGradient(x,y,x,y+10), s:[[0,`rgba(220,235,255,${frostA*.4})`],[1,'transparent']]},
      ];
      edges.forEach(e=>{ e.s.forEach(([pos,col])=>e.g.addColorStop(pos,col)); cx.fillStyle=e.g; cx.fillRect(x,y,w,h); });
      // Frost crystals — tiny random specks along bottom edge
      cx.globalAlpha=frostA*.6;
      for(let i=0;i<38;i++){
        const fx=x+4+Math.random()*(w-8);
        const fy=y+h-2-Math.random()*10;
        cx.fillStyle='rgba(235,245,255,.7)';
        cx.fillRect(fx,fy,1,1);
      }
      cx.restore();
    }
  }
}

function drawCinematicFloorReflections(){
  const fy=R.floorY;
  cx.save();
  cx.beginPath(); cx.rect(0,fy,W,H-fy); cx.clip();
  cx.globalCompositeOperation='screen';

  // v0.35: cleaner, more local reflections. Prevents the lower-left area from becoming hazy.
  const pulse=clamp(S.neonPulse||1,.55,1.25);
  const city=cx.createRadialGradient(W*.52,fy+20,0,W*.52,fy+42,145);
  city.addColorStop(0,'rgba(105,190,255,'+(.020*pulse)+')');
  city.addColorStop(.42,'rgba(185,55,255,'+(.012*pulse)+')');
  city.addColorStop(1,'transparent');
  cx.fillStyle=city;
  cx.beginPath(); cx.ellipse(W*.52,fy+34,170,14,0,0,Math.PI*2); cx.fill();

  const holo=cx.createRadialGradient(R.holo.x,R.holo.y+34,0,R.holo.x,R.holo.y+42,38);
  holo.addColorStop(0,'rgba(185,135,255,.026)');
  holo.addColorStop(.45,'rgba(110,210,255,.008)');
  holo.addColorStop(1,'transparent');
  cx.fillStyle=holo;
  cx.fillRect(R.holo.x-44,R.holo.y+22,88,40);

  if(S.tvOn){
    const f=.70+Math.sin(S.t*2.2)*.12+Math.sin(S.t*5.8)*.04;
    const g=cx.createRadialGradient(R.tv.x+20,R.floorY+68,0,R.tv.x-10,H+4,138);
    g.addColorStop(0,'rgba(90,210,255,'+(.020*f)+')');
    g.addColorStop(.42,'rgba(150,90,255,'+(.010*f)+')');
    g.addColorStop(1,'transparent');
    cx.fillStyle=g;
    cx.fillRect(W*.52,fy,W*.48,H-fy);
  }

  if(S.lightning>0){
    const a=Math.sin(S.lightning*Math.PI);
    const boost=S.weather?.thunderstorm?1.85:1;
    const g=cx.createLinearGradient(0,fy,W,H);
    g.addColorStop(0,'rgba(185,220,255,'+(.065*a*boost)+')');
    g.addColorStop(.55,'rgba(255,255,255,'+(.022*a)+')');
    g.addColorStop(1,'transparent');
    cx.fillStyle=g; cx.fillRect(0,fy,W,H-fy);
  }
  cx.restore();
}

function drawReactiveLightingPass(){
  cx.save();
  cx.globalCompositeOperation='screen';

  // v0.35: reduced broad wash. Lighting now reads as directional rather than foggy.
  if(S.lightning>0){
    const a=Math.sin(S.lightning*Math.PI);
    const boost=S.weather?.thunderstorm?1.95:1;
    cx.fillStyle='rgba(180,220,255,'+(.045*a*boost)+')';
    cx.fillRect(0,0,W,H);
    const wg=cx.createRadialGradient(R.win.x+R.win.w*.55,R.win.y+R.win.h*.35,0,R.win.x+R.win.w*.55,R.win.y+R.win.h*.35,W*.48);
    wg.addColorStop(0,'rgba(210,235,255,'+(.110*a)+')');
    wg.addColorStop(.5,'rgba(120,180,255,'+(.032*a)+')');
    wg.addColorStop(1,'transparent');
    cx.fillStyle=wg; cx.fillRect(0,0,W,H);
  }

  if(S.lampOn){
    const g=cx.createRadialGradient(R.lamp.x,R.lamp.y-10,0,R.lamp.x+28,R.lamp.y+24,128);
    g.addColorStop(0,'rgba(255,174,80,'+(.038*S.lampFlk)+')');
    g.addColorStop(.46,'rgba(255,120,70,'+(.012*S.lampFlk)+')');
    g.addColorStop(1,'transparent');
    cx.fillStyle=g;
    cx.fillRect(0,90,215,175);
  }

  const open=clamp(S.winAnim||0,0,1);
  const spill=cx.createLinearGradient(R.win.x,R.win.y+R.win.h,R.win.x+R.win.w,R.floorY+112);
  spill.addColorStop(0,'rgba(120,210,255,'+(.012+.014*open)+')');
  spill.addColorStop(.48,'rgba(210,45,255,'+(.006+.008*open)+')');
  spill.addColorStop(1,'transparent');
  cx.fillStyle=spill;
  cx.fillRect(R.win.x+8,R.win.y+R.win.h-4,R.win.w-16,88);

  cx.restore();
}

// ── HUSH OS v0.35 COMPOSITION CLEANUP PASS ─────────────────────

function drawFocusAtmosphere(){
  if(S.focus==='window'){
    cx.fillStyle=S.windowLean?'rgba(3,3,10,.20)':'rgba(5,4,12,.10)';
    cx.fillRect(0,0,RW,RH);
    const r=R.win;
    const g=cx.createRadialGradient(r.x+r.w/2,r.y+r.h/2,20,r.x+r.w/2,r.y+r.h/2,r.w*.75);
    g.addColorStop(0,S.windowLean?'rgba(120,190,255,.10)':'rgba(120,170,255,.055)');
    g.addColorStop(1,'transparent');
    cx.fillStyle=g;
    cx.fillRect(r.x-40,r.y-30,r.w+80,r.h+70);
  } else if(S.focus==='tv'){
    cx.fillStyle='rgba(6,5,12,.08)';
    cx.fillRect(0,0,RW,RH);
  } else if(S.focus==='holo'){
    const r=R.holo;
    const g=cx.createRadialGradient(r.x+r.w/2,r.y+r.h/2,4,r.x+r.w/2,r.y+r.h/2,90);
    g.addColorStop(0,'rgba(160,120,255,.09)');
    g.addColorStop(1,'transparent');
    cx.fillStyle=g;
    cx.fillRect(r.x-90,r.y-90,180,180);
  }
}


function drawFocusHighlight(){
  if(!S.hover||S.focus)return;
  const h=S.hover;
  cx.save(); cx.globalAlpha=.25; cx.strokeStyle=h.col; cx.lineWidth=1.2;
  rr(cx,h.x-2,h.y-2,h.w+4,h.h+4,6,false,true);
  cx.restore(); cx.lineWidth=1;
}


// ── HUSH OS v0.35 LIGHTMAP PASS ────────────────────────────────
function drawV16LightmapPass(){
  const LS=LIGHTMAP_SCALE;

  lmx.setTransform(1,0,0,1,0,0);
  smx.setTransform(1,0,0,1,0,0);
  lmx.clearRect(0,0,lmCv.width,lmCv.height);
  smx.clearRect(0,0,smCv.width,smCv.height);
  lmx.setTransform(LS,0,0,LS,0,0);
  smx.setTransform(LS,0,0,LS,0,0);

  function lmRad(x,y,r,stops){
    const g=lmx.createRadialGradient(x,y,0,x,y,r);
    stops.forEach(([p,c])=>g.addColorStop(p,c));
    lmx.fillStyle=g;
    lmx.fillRect(x-r,y-r,r*2,r*2);
  }
  function smRad(x,y,rx,ry,a){
    smx.save();
    smx.translate(x,y);
    smx.scale(1,ry/rx);
    const g=smx.createRadialGradient(0,0,1,0,0,rx);
    g.addColorStop(0,`rgba(0,0,0,${a})`);
    g.addColorStop(.55,`rgba(0,0,0,${a*.38})`);
    g.addColorStop(1,'transparent');
    smx.fillStyle=g;
    smx.beginPath();
    smx.arc(0,0,rx,0,Math.PI*2);
    smx.fill();
    smx.restore();
  }
  function lmBeam(points,stops){
    const minX=Math.min(...points.map(p=>p[0])), maxX=Math.max(...points.map(p=>p[0]));
    const minY=Math.min(...points.map(p=>p[1])), maxY=Math.max(...points.map(p=>p[1]));
    const g=lmx.createLinearGradient(minX,minY,maxX,maxY);
    stops.forEach(([p,c])=>g.addColorStop(p,c));
    lmx.fillStyle=g;
    lmx.beginPath();
    points.forEach(([x,y],i)=>i?lmx.lineTo(x,y):lmx.moveTo(x,y));
    lmx.closePath();
    lmx.fill();
  }

  // Shadow map: makes objects feel attached to surfaces.
  smx.globalCompositeOperation='source-over';
  smx.filter='blur(5px)';
  smRad(R.holo.x,R.holo.y+24,42,12,.28);
  smRad(R.radio.x+R.radio.w*.54,R.radio.y+R.radio.h+5,66,14,.34);
  smRad(R.tv.x+R.tv.w*.55,R.tv.y+R.tv.h+9,58,14,.30);
  smRad(R.lamp.x,R.lamp.y+14,42,10,.24);

  // Directional occlusion under the window sill and behind furniture.
  smx.filter='blur(3px)';
  let sill=smx.createLinearGradient(R.win.x,R.floorY-18,R.win.x,R.floorY+22);
  sill.addColorStop(0,'transparent');
  sill.addColorStop(.45,'rgba(0,0,0,.22)');
  sill.addColorStop(1,'transparent');
  smx.fillStyle=sill;
  smx.fillRect(R.win.x-10,R.floorY-18,R.win.w+20,46);

  // Light map: window spill, holocube, radio amber, lamp warmth and TV glow.
  lmx.globalCompositeOperation='screen';
  lmx.filter='blur(6px)';

  const tp=timeProfile();
  const windowA=.12*tp.night + .18*tp.day + .20*tp.sunset;
  const windowB=.035*tp.night + .060*tp.day + .070*tp.sunset;
  const c1=`${(120*tp.night + 145*tp.day + 255*tp.sunset)|0},${(80*tp.night + 205*tp.day + 150*tp.sunset)|0},${(255*tp.night + 255*tp.day + 70*tp.sunset)|0}`;
  const c2=`${(240*tp.night + 220*tp.day + 255*tp.sunset)|0},${(45*tp.night + 240*tp.day + 60*tp.sunset)|0},${(220*tp.night + 255*tp.day + 160*tp.sunset)|0}`;

  // Window light lands as a trapezoid, not a fog blanket.
  lmBeam([
    [R.win.x+36,R.floorY-4],
    [R.win.x+R.win.w-34,R.floorY-4],
    [R.win.x+R.win.w*.82,H+18],
    [R.win.x+R.win.w*.18,H+18]
  ],[
    [0,`rgba(${c1},${windowA})`],
    [.48,`rgba(${c2},${windowB})`],
    [1,'transparent']
  ]);

  // Thin light strip on the sill edge.
  const sillLight=lmx.createLinearGradient(R.win.x,R.floorY-2,R.win.x+R.win.w,R.floorY+4);
  sillLight.addColorStop(0,'rgba(120,160,255,.045)');
  sillLight.addColorStop(.5,'rgba(255,80,220,.070)');
  sillLight.addColorStop(1,'rgba(80,200,255,.045)');
  lmx.fillStyle=sillLight;
  lmx.fillRect(R.win.x,R.floorY-2,R.win.w,6);

  if(S.lampOn){
    lmRad(R.lamp.x+6,R.lamp.y-26,88,[
      [0,`rgba(255,190,105,${.145*S.lampFlk})`],
      [.36,`rgba(255,130,80,${.045*S.lampFlk})`],
      [1,'transparent']
    ]);
    lmBeam([[R.lamp.x-22,R.lamp.y-20],[R.lamp.x+48,R.lamp.y-10],[R.lamp.x+96,R.floorY+12],[R.lamp.x-42,R.floorY+6]],[
      [0,`rgba(255,170,90,${.048*S.lampFlk})`],
      [.7,`rgba(255,120,70,${.016*S.lampFlk})`],
      [1,'transparent']
    ]);
  }

  if(S.radioOn){
    lmRad(R.radio.x+92,R.radio.y+30,58,[
      [0,'rgba(255,170,85,.080)'],
      [.45,'rgba(255,105,55,.022)'],
      [1,'transparent']
    ]);
  }

  if(S.tvOn){
    const p=.75+Math.sin(S.t*2.1)*.16+Math.sin(S.t*5.2)*.06;
    const col=S.tvCh===1?'80,210,255':S.tvCh===2?'225,60,255':'150,120,255';
    lmRad(R.tv.x+34,R.tv.y+42,78,[
      [0,`rgba(${col},${.085*p})`],
      [.42,`rgba(${col},${.024*p})`],
      [1,'transparent']
    ]);
  }

  // Holocube gets local light only, so the tabletop does not become a purple fog bank.
  lmRad(R.holo.x,R.holo.y-10,48,[
    [0,'rgba(175,125,255,.135)'],
    [.38,'rgba(160,85,255,.038)'],
    [1,'transparent']
  ]);
  const cubeFloor=lmx.createRadialGradient(R.holo.x,R.holo.y+18,2,R.holo.x,R.holo.y+18,42);
  cubeFloor.addColorStop(0,'rgba(170,105,255,.065)');
  cubeFloor.addColorStop(.45,'rgba(160,70,255,.018)');
  cubeFloor.addColorStop(1,'transparent');
  lmx.fillStyle=cubeFloor;
  lmx.fillRect(R.holo.x-48,R.holo.y-2,96,54);

  // Apply shadow map first, then light map.
  cx.save();
  cx.globalCompositeOperation='multiply';
  cx.globalAlpha=.76;
  cx.imageSmoothingEnabled=true;
  cx.drawImage(smCv,0,0,RW,RH);
  cx.restore();

  cx.save();
  cx.globalCompositeOperation='screen';
  cx.globalAlpha=.78;
  cx.imageSmoothingEnabled=true;
  cx.drawImage(lmCv,0,0,RW,RH);
  cx.restore();
}

// ── DYNAMIC LIGHT PASS ───────────────────────────────
function drawDynamicLightPass(){
  cx.save();
  cx.globalCompositeOperation='screen';

  // v0.35: cleaner, more directional lighting. Removes the muddy amber haze on the left.
  if(S.lampOn){
    const lampWarm=cx.createRadialGradient(R.lamp.x,R.lamp.y-22,0,R.lamp.x+18,R.lamp.y+22,122);
    lampWarm.addColorStop(0,'rgba(255,190,105,'+(.060*S.lampFlk)+')');
    lampWarm.addColorStop(.38,'rgba(255,125,80,'+(.020*S.lampFlk)+')');
    lampWarm.addColorStop(1,'transparent');
    cx.fillStyle=lampWarm;
    cx.fillRect(0,118,214,150);

    const knob=cx.createRadialGradient(R.radio.x+88,R.radio.y+34,0,R.radio.x+88,R.radio.y+34,54);
    knob.addColorStop(0,'rgba(255,170,95,.034)');
    knob.addColorStop(1,'transparent');
    cx.fillStyle=knob;
    cx.fillRect(R.radio.x+36,R.radio.y-4,108,70);
  }

  if(S.tvOn){
    const pulse=.72+Math.sin(S.t*2.1)*.16+Math.sin(S.t*5.2)*.06;
    const col=S.tvCh===1?'80,210,255':S.tvCh===2?'225,60,255':'150,120,255';
    const tvLight=cx.createRadialGradient(R.tv.x+30,R.tv.y+35,0,R.tv.x-38,R.tv.y+96,132);
    tvLight.addColorStop(0,'rgba('+col+','+(.042*pulse)+')');
    tvLight.addColorStop(.45,'rgba('+col+','+(.014*pulse)+')');
    tvLight.addColorStop(1,'transparent');
    cx.fillStyle=tvLight;
    cx.fillRect(R.tv.x-145,R.tv.y-28,236,174);

    const tvFloor=cx.createRadialGradient(R.tv.x+20,R.floorY+42,4,R.tv.x-42,R.floorY+82,118);
    tvFloor.addColorStop(0,'rgba('+col+','+(.034*pulse)+')');
    tvFloor.addColorStop(1,'transparent');
    cx.fillStyle=tvFloor;
    cx.fillRect(R.tv.x-150,R.floorY-4,210,105);
  }

  const tp=timeProfile();
  const spillA=.024*tp.night + .060*tp.day + .072*tp.sunset;
  const spillB=.018*tp.night + .038*tp.day + .046*tp.sunset;
  const spill1=`${(245*tp.night + 160*tp.day + 255*tp.sunset)|0},${(35*tp.night + 210*tp.day + 155*tp.sunset)|0},${(210*tp.night + 255*tp.day + 72*tp.sunset)|0}`;
  const spill2=`${(90*tp.night + 210*tp.day + 240*tp.sunset)|0},${(60*tp.night + 235*tp.day + 70*tp.sunset)|0},${(230*tp.night + 255*tp.day + 160*tp.sunset)|0}`;
  const ng=cx.createLinearGradient(R.win.x,R.floorY,R.win.x+R.win.w,R.floorY+95);
  ng.addColorStop(0,'rgba('+spill1+','+(spillA*clamp(S.neonPulse,.55,1.25))+')');
  ng.addColorStop(.55,'rgba('+spill2+','+(spillB*clamp(S.neonPulse,.55,1.25))+')');
  ng.addColorStop(1,'transparent');
  cx.fillStyle=ng;
  cx.fillRect(R.win.x-18,R.floorY,R.win.w+36,96);

  cx.save();
  cx.beginPath(); cx.rect(R.win.x+4,R.win.y+4,R.win.w-8,R.win.h-8); cx.clip();
  const glassShade=cx.createLinearGradient(R.win.x,R.win.y,R.win.x+R.win.w,R.win.y+R.win.h);
  glassShade.addColorStop(0,'rgba(255,170,100,.020)');
  glassShade.addColorStop(.45,'transparent');
  glassShade.addColorStop(1,'rgba(120,180,255,.040)');
  cx.fillStyle=glassShade; cx.fillRect(R.win.x,R.win.y,R.win.w,R.win.h);
  cx.strokeStyle='rgba(255,255,255,.055)'; cx.lineWidth=1;
  rr(cx,R.win.x+2,R.win.y+2,R.win.w-4,R.win.h-4,7,false,true);
  cx.restore();

  if(S.siren>0){
    const a=Math.sin(S.siren*Math.PI);
    const x=lerp(-180,W+80,1-S.siren);
    const col=S.sirenHue?'75,180,255':'255,70,120';
    const sg=cx.createLinearGradient(x-80,0,x+180,0);
    sg.addColorStop(0,'transparent');
    sg.addColorStop(.5,'rgba('+col+','+(.045*a).toFixed(3)+')');
    sg.addColorStop(1,'transparent');
    cx.fillStyle=sg;
    cx.fillRect(0,R.floorY-18,W,112);
  }

  cx.restore();
}

// ── GLOW CANVAS ──────────────────────────────────────
function drawGlowCanvas(){
  S.glowDirty=false;
  const GW=glowCv.width, GH=glowCv.height;
  gcx.clearRect(0,0,GW,GH);

  const ox=(GW-RW*SCALE)/2, oy=(GH-RH*SCALE)/2;
  const p=(x,y)=>[ox+x*SCALE, oy+y*SCALE];

  function rg(center,radius,stops){
    const g=gcx.createRadialGradient(...center,0,...center,radius);
    stops.forEach(([pos,col])=>g.addColorStop(pos,col));
    gcx.fillStyle=g; gcx.fillRect(0,0,GW,GH);
  }

  // Window horizon bloom — big, purple
  rg(p(R.win.x+R.win.w/2, R.win.y+R.win.h*.72), GW*.35, [
    [0,`rgba(200,20,255,${.18*S.neonPulse})`],
    [.3,`rgba(140,10,200,${.075*S.neonPulse})`],
    [.7,'rgba(80,10,180,.03)'],
    [1,'transparent'],
  ]);

  // Window ambient — cool blue
  rg(p(R.win.x+R.win.w/2, R.win.y+R.win.h/2), GW*.22, [
    [0,`rgba(80,60,200,${.105*S.neonPulse})`],
    [1,'transparent'],
  ]);

  // Floor neon pool under window
  rg(p(R.win.x+R.win.w/2, R.floorY+40), GW*.25, [
    [0,'rgba(160,30,255,.1)'],
    [.5,'rgba(100,20,200,.04)'],
    [1,'transparent'],
  ]);

  // Holocube glow
  rg(p(R.holo.x, R.holo.y-12), GW*.055, [
    [0,'rgba(170,140,255,.18)'],[1,'transparent'],
  ]);

  // Lamp bloom — violet-white arc lamp glow
  if(S.lampOn){
    rg(p(R.lamp.x+28, R.lamp.y-50), GW*.10, [
      [0,`rgba(200,160,255,${.22*S.lampFlk})`],
      [.35,`rgba(160,120,255,${.09*S.lampFlk})`],
      [1,'transparent'],
    ]);
  }

  // Soft passing siren glow on the full-resolution bloom layer.
  if(S.siren>0){
    const a=Math.sin(S.siren*Math.PI);
    const sx=lerp(-GW*.15,GW*1.1,1-S.siren);
    const col=S.sirenHue?'rgba(80,190,255,':'rgba(255,70,135,';
    const sg=gcx.createRadialGradient(sx, GH*.64, 0, sx, GH*.64, GW*.28);
    sg.addColorStop(0,`${col}${(.11*a).toFixed(3)})`);
    sg.addColorStop(1,'transparent');
    gcx.fillStyle=sg;
    gcx.fillRect(0,0,GW,GH);
  }
}


function closeTimeController(){
  const panel=UI.timeUi || document.getElementById('timeUi');
  if(panel) panel.classList.remove('show');
}

function toggleTimeController(){
  const panel=UI.timeUi || document.getElementById('timeUi');
  panel.classList.toggle('show');
  const lbl=UI.label || document.getElementById('label');
  lbl.textContent='[ CLOCK / TIME CONTROL ]';
  lbl.style.color='#8de0ff';
  lbl.classList.add('show');
  clearTimeout(S.timeClockLabelTimer);
  S.timeClockLabelTimer=setTimeout(()=>{ if(!S.hover) lbl.classList.remove('show'); },900);
}

function activateHolocube(){
  S.holoMode=(S.holoMode+1)%4;
  S.holoPulse=1.35;
  const moods=['calm','rain','neon','midnight'];
  setMood(moods[(moods.indexOf(S.mood)+1+moods.length)%moods.length]);
  const modeLabels=['CUBE','RINGS','BARS','HELIX'];
  const lbl=document.getElementById('label');
  lbl.textContent='[ HOLO: '+modeLabels[S.holoMode]+' → '+S.mood.toUpperCase()+' ]';
  lbl.style.color='#c8b8ff';
  lbl.classList.add('show');
  clearTimeout(S.holoLabelTimer);
  S.holoLabelTimer=setTimeout(()=>{ if(!S.hover) lbl.classList.remove('show'); },1100);
  if(S.focus!=='holo') setFocus('holo');
}


function setTimeOfDay(mode){
  const anchors={
    day:[10,18],
    sunset:[18,42],
    night:[22,47]
  };

  S.timeCycle=(mode==='cycle');

  if(S.timeCycle){
    // Cycle is still offset-based: start at the day anchor, then accelerate
    // the real clock rather than replacing it with a fake clock.
    setManualTime(anchors.day[0],anchors.day[1],false);
    S.timeCycle=true;
    S.timeOfDay='cycle';
    setTimeSpeed(160);
  } else if(anchors[mode]){
    S.timeCycle=false;
    setTimeSpeed(1);
    setManualTime(anchors[mode][0],anchors[mode][1],false);
    S.timeOfDay=mode;
  }

  updateTimeChipState(mode);
  const txt=UI.timeTxt || document.getElementById('timeTxt');
  if(txt) txt.textContent=mode.toUpperCase();
  refreshClockDom();
  updateDevTimeReadout();

  const lbl=document.getElementById('label');
  lbl.textContent='[ CLOCK → '+mode.toUpperCase()+' ]';
  lbl.style.color=mode==='day'?'#dff4ff':mode==='sunset'?'#ffbf74':mode==='cycle'?'#d6c8ff':'#9fe2ff';
  lbl.classList.add('show');
  updateAmbience(.65);
  clearTimeout(S.timeLabelTimer);
  S.timeLabelTimer=setTimeout(()=>{ if(!S.hover) lbl.classList.remove('show'); },1000);
}

function syncWeatherUi(){
  document.querySelectorAll('[data-weather]').forEach(el=>el.classList.toggle('on',!!S.weather[el.dataset.weather]));

  const map={rain:'dev-weather-rain',snow:'dev-weather-snow',mist:'dev-weather-mist',thunderstorm:'dev-weather-thunderstorm'};
  Object.entries(map).forEach(([kind,id])=>{
    const el=document.getElementById(id);
    if(el) el.checked=!!S.weather[kind];
  });
}

function setWeather(kind,enabled){
  if(kind==='storm') kind='thunderstorm';
  if(kind==='fog') kind='mist';
  if(!Object.prototype.hasOwnProperty.call(S.weather,kind)) return;

  S.weather[kind]=!!enabled;

  if(kind==='snow' && S.weather.snow){
    S.weather.rain=false;
    S.weather.thunderstorm=false;
  }
  if(kind==='rain' && S.weather.rain){
    S.weather.snow=false;
    S.weather.thunderstorm=false;
  }
  if(kind==='thunderstorm' && S.weather.thunderstorm){
    S.weather.rain=true;
    S.weather.snow=false;
    S.weather.mist=false;
  }
  if(kind==='thunderstorm' && !S.weather.thunderstorm){
    S.thunderPulse=0;
    S.stormWind=0;
  }

  syncWeatherUi();
  const active=S.weather.thunderstorm ? 'THUNDERSTORM' : (Object.keys(S.weather).filter(k=>S.weather[k]).map(k=>k.toUpperCase()).join(' + ') || 'CLEAR');
  const lbl=document.getElementById('label');
  lbl.textContent='[ WEATHER → '+active+' ]';
  lbl.style.color=S.weather.thunderstorm?'#d8e6ff':'#bde9ff';
  lbl.classList.add('show');
  updateAmbience(.65);
  clearTimeout(S.weatherLabelTimer);
  S.weatherLabelTimer=setTimeout(()=>{ if(!S.hover) lbl.classList.remove('show'); },1100);
}

function toggleWeather(kind){
  setWeather(kind,!S.weather[kind]);
}

function setupDevPanel(){
  if(document.getElementById('dev-panel')) return;

  const devPanel=document.createElement('div');
  devPanel.id='dev-panel';
  devPanel.style.cssText=[
    'display:none',
    'position:fixed',
    'top:20px',
    'right:20px',
    'background:rgba(0,0,0,.86)',
    'color:white',
    'padding:16px',
    'border-radius:10px',
    'font-family:monospace',
    'font-size:13px',
    'z-index:99999',
    'width:282px',
    'box-shadow:0 4px 22px rgba(0,0,0,.55)',
    'border:1px solid rgba(255,255,255,.12)',
    'backdrop-filter:blur(10px)',
    'cursor:auto'
  ].join(';');

  devPanel.innerHTML=`
    <div style="margin-bottom:10px;font-weight:bold;letter-spacing:.5px">Hush OS v${VERSION} Dev Panel</div>

    <label for="dev-time">Time scrubber</label><br>
    <input type="range" id="dev-time" min="0" max="23.99" step="0.01" value="12" style="width:100%;cursor:pointer">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:5px">
      <span id="dev-time-label">12:00</span>
      <button id="dev-sync-time" style="cursor:pointer">Sync real time</button>
    </div>

    <br>
    <label for="dev-speed">Speed multiplier</label><br>
    <input type="range" id="dev-speed" min="1" max="240" step="1" value="1" style="width:100%;cursor:pointer">
    <span id="dev-speed-label">1x</span>

    <br><br>
    <label>Weather</label><br>
    <label><input type="checkbox" id="dev-weather-rain" data-dev-weather="rain"> Rain</label><br>
    <label><input type="checkbox" id="dev-weather-snow" data-dev-weather="snow"> Snow</label><br>
    <label><input type="checkbox" id="dev-weather-mist" data-dev-weather="mist"> Mist / fog</label><br>
    <label><input type="checkbox" id="dev-weather-thunderstorm" data-dev-weather="thunderstorm"> Thunderstorm</label>

    <div style="margin-top:10px;opacity:.58;font-size:11px;line-height:1.35">
      Ctrl+Shift+D toggles this panel. Hidden from normal users.
    </div>
  `;

  document.body.appendChild(devPanel);

  const timeInput=document.getElementById('dev-time');
  timeInput.addEventListener('input',e=>{
    const value=Number(e.target.value);
    const h=Math.floor(value);
    const m=Math.round((value-h)*60)%60;
    setManualTime(h,m,true);
    updateDevTimeReadout();
  });

  document.getElementById('dev-sync-time').addEventListener('click',()=>{
    clearManualTime(20);
    setTimeSpeed(1);
  });

  document.getElementById('dev-speed').addEventListener('input',e=>{
    setTimeSpeed(Number(e.target.value));
  });

  devPanel.querySelectorAll('[data-dev-weather]').forEach(el=>{
    el.addEventListener('change',e=>setWeather(e.target.dataset.devWeather,e.target.checked));
  });

  document.addEventListener('keydown',e=>{
    if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='d'){
      e.preventDefault();
      devPanel.style.display=devPanel.style.display==='none'?'block':'none';
      updateDevTimeReadout();
      syncWeatherUi();
    }
  });

  updateDevTimeReadout();
  syncWeatherUi();
}


function updateEmotionalLayer(dt){
  // Rare, almost-questionable moments. No obvious story, no jumpscare.
  S.emotionalNext -= dt;
  if(S.emotionalNext<=0 && !S.emotionalKind){
    const pool=['cityDim','neonWrong','holoPause','radioGhost','roomFlicker'];
    S.emotionalKind=pool[Math.floor(Math.random()*pool.length)];
    S.emotionalA=1;
    S.emotionalHold=S.emotionalKind==='radioGhost'?1.8:(S.emotionalKind==='roomFlicker'?1.2:2.4+Math.random()*2.4);
    S.emotionalNext=90+Math.random()*220;
    if(S.emotionalKind==='radioGhost') S.audioAnomaly=1;
    if(S.emotionalKind==='roomFlicker') S.glowDirty=true;
  }
  if(S.emotionalKind){
    S.emotionalHold-=dt;
    if(S.emotionalKind==='radioGhost') S.audioAnomaly=Math.max(0,S.audioAnomaly-dt*.48);
    if(S.emotionalHold<=0){
      S.emotionalA=Math.max(0,S.emotionalA-dt*.8);
      if(S.emotionalA<=0.01){ S.emotionalKind=null; S.emotionalA=0; S.audioAnomaly=0; S.glowDirty=true; }
    }
  }
}

function drawEmotionalLayer(){
  if(!S.emotionalKind || S.emotionalA<=0.001) return;
  const a=clamp(S.emotionalA,0,1);
  cx.save();
  if(S.emotionalKind==='cityDim'){
    cx.fillStyle=`rgba(0,0,10,${0.075*a})`;
    cx.fillRect(R.win.x,R.win.y,R.win.w,R.win.h);
    const blink=Math.sin(S.t*18)>0.25?1:.25;
    cx.fillStyle=`rgba(180,220,255,${0.045*a*blink})`;
    cx.fillRect(R.win.x+R.win.w*.62,R.win.y+R.win.h*.34,34,2);
  }
  if(S.emotionalKind==='neonWrong'){
    cx.globalCompositeOperation='screen';
    const g=cx.createRadialGradient(R.win.x+R.win.w*.54,R.win.y+R.win.h*.58,0,R.win.x+R.win.w*.54,R.win.y+R.win.h*.58,170);
    g.addColorStop(0,`rgba(255,30,120,${0.055*a})`);
    g.addColorStop(1,'transparent');
    cx.fillStyle=g; cx.fillRect(R.win.x,R.win.y,R.win.w,R.win.h);
    cx.fillStyle=`rgba(255,70,180,${0.22*a})`;
    cx.fillRect(R.win.x+R.win.w*.70,R.win.y+R.win.h*.24,28,1);
  }
  if(S.emotionalKind==='holoPause'){
    cx.globalCompositeOperation='screen';
    const pulse=.65+.35*Math.sin(S.t*2.4);
    const g=cx.createRadialGradient(R.holo.x,R.holo.y+2,0,R.holo.x,R.holo.y+2,72);
    g.addColorStop(0,`rgba(190,160,255,${0.10*a*pulse})`);
    g.addColorStop(1,'transparent');
    cx.fillStyle=g; cx.fillRect(R.holo.x-80,R.holo.y-80,160,160);
  }
  if(S.emotionalKind==='radioGhost'){
    cx.globalCompositeOperation='screen';
    const g=cx.createRadialGradient(R.radio.x+R.radio.w*.45,R.radio.y+R.radio.h*.5,0,R.radio.x+R.radio.w*.45,R.radio.y+R.radio.h*.5,64);
    g.addColorStop(0,`rgba(255,190,120,${0.055*a})`);
    g.addColorStop(1,'transparent');
    cx.fillStyle=g; cx.fillRect(R.radio.x-40,R.radio.y-50,150,120);
  }

  if(S.emotionalKind==='roomFlicker'){
    const pulse=(Math.sin(S.t*38)>0.15?1:.35) * (.75+.25*Math.sin(S.t*9));
    cx.globalCompositeOperation='screen';
    const rg=cx.createRadialGradient(W*.50,H*.46,40,W*.50,H*.46,360);
    rg.addColorStop(0,`rgba(150,170,210,${(0.028*a*pulse).toFixed(3)})`);
    rg.addColorStop(.55,`rgba(190,120,255,${(0.018*a*pulse).toFixed(3)})`);
    rg.addColorStop(1,'transparent');
    cx.fillStyle=rg; cx.fillRect(0,0,W,H);
    cx.globalCompositeOperation='multiply';
    cx.fillStyle=`rgba(30,24,38,${(0.035*a*(1-pulse*.5)).toFixed(3)})`;
    cx.fillRect(0,0,W,H);
  }
  cx.restore();
}

function smoothstep01(v){
  v=clamp(v,0,1);
  return v*v*(3-2*v);
}

function currentTimeWeights(){
  return timeWeightsFromMinutes(getWorldMinutes());
}

function updateLivingTime(dt, immediate=false){
  const target=currentTimeWeights();
  S.timeBlend.day=target.day;
  S.timeBlend.sunset=target.sunset;
  S.timeBlend.night=target.night;

  const dominant=dominantTimeMode(S.timeBlend);
  if(!S.timeCycle) S.timeOfDay=dominant;

  const txt=UI.timeTxt || document.getElementById('timeTxt');
  if(txt) txt.textContent=S.timeCycle ? 'CYCLE / '+dominant.toUpperCase() : dominant.toUpperCase();

  updateTimeChipState(S.timeCycle ? 'cycle' : dominant);
}

function getWorldMinutes(){
  const d=getRealTime();
  return d.getHours()*60+d.getMinutes();
}

function rgbaMix(day,sunset,night,aScale=1){
  const w=S.timeBlend||{day:0,sunset:0,night:1};
  const r=day[0]*w.day+sunset[0]*w.sunset+night[0]*w.night;
  const g=day[1]*w.day+sunset[1]*w.sunset+night[1]*w.night;
  const b=day[2]*w.day+sunset[2]*w.sunset+night[2]*w.night;
  const a=(day[3]*w.day+sunset[3]*w.sunset+night[3]*w.night)*aScale;
  return `rgba(${r|0},${g|0},${b|0},${a.toFixed(3)})`;
}

function timeProfile(){
  const w=S.timeBlend||{day:0,sunset:0,night:1};
  return {
    day:w.day,
    sunset:w.sunset,
    night:w.night,

    // Daylight should not behave like neon.
    // Sunset keeps some glow, night keeps the full cyberpunk ambience.
    neon:.10*w.day+.55*w.sunset+1*w.night
  };
}

function drawTimeOfDayWindowGrade(){
  const {x,y,w,h}=R.win;
  const tp=timeProfile();
  if(tp.day<.01 && tp.sunset<.01) return;

  cx.save();
  cx.beginPath();
  cx.rect(x,y,w,h);
  cx.clip();

  // Daylight should feel like atmosphere outside, not a glowing screen.
  if(tp.day>.01){
    cx.globalCompositeOperation='screen';

    const sky=cx.createLinearGradient(x,y,x,y+h);
    sky.addColorStop(0,`rgba(185,205,215,${(.065*tp.day).toFixed(3)})`);
    sky.addColorStop(.55,`rgba(150,175,190,${(.040*tp.day).toFixed(3)})`);
    sky.addColorStop(1,`rgba(220,230,225,${(.025*tp.day).toFixed(3)})`);
    cx.fillStyle=sky;
    cx.fillRect(x,y,w,h);

    // Counter-tint to stop the window becoming milky white.
    cx.globalCompositeOperation='multiply';
    cx.fillStyle=`rgba(70,78,88,${(.06*tp.day).toFixed(3)})`;
    cx.fillRect(x,y,w,h);
  }

  if(tp.sunset>.01){
    cx.globalCompositeOperation='screen';

    // Broad warm atmosphere, not a sun beam.
    const dusk=cx.createLinearGradient(x,y,x,y+h);
    dusk.addColorStop(0,`rgba(255,165,105,${(.075*tp.sunset).toFixed(3)})`);
    dusk.addColorStop(.55,`rgba(210,100,95,${(.050*tp.sunset).toFixed(3)})`);
    dusk.addColorStop(1,`rgba(255,195,125,${(.035*tp.sunset).toFixed(3)})`);
    cx.fillStyle=dusk;
    cx.fillRect(x,y,w,h);

    // Very soft horizon lift only.
    const horizon=cx.createLinearGradient(x,y+h*.68,x,y+h);
    horizon.addColorStop(0,'transparent');
    horizon.addColorStop(1,`rgba(255,180,100,${(.07*tp.sunset).toFixed(3)})`);
    cx.fillStyle=horizon;
    cx.fillRect(x,y,w,h);
  }

  cx.restore();
}

function drawWindowLightSpill(){
  const {x,y,w,h}=R.win;
  const tp=timeProfile();

  const day = tp.day || 0;
  const sunset = tp.sunset || 0;
  const night = tp.night || 0;

  if(day < .01 && sunset < .01 && night < .01) return;

  cx.save();

  // 1. Soft floor spill from the window into the room.
  // This is what makes daylight feel like it enters the space.
  if(day > .01 || sunset > .01){
    cx.globalCompositeOperation='screen';

    const spillY = y + h - 4;
    const spill = cx.createRadialGradient(
      x + w*.5, spillY, 0,
      x + w*.5, spillY + 72, 250
    );

    if(day > sunset){
      spill.addColorStop(0,`rgba(225,230,220,${(.12*day).toFixed(3)})`);
      spill.addColorStop(.35,`rgba(190,205,205,${(.075*day).toFixed(3)})`);
      spill.addColorStop(1,'transparent');
    } else {
      spill.addColorStop(0,`rgba(255,170,105,${(.16*sunset).toFixed(3)})`);
      spill.addColorStop(.38,`rgba(220,95,110,${(.08*sunset).toFixed(3)})`);
      spill.addColorStop(1,'transparent');
    }

    cx.fillStyle=spill;
    cx.fillRect(x-110, y+h-20, w+220, 175);
  }

  // 2. Subtle room exposure lift for day.
  // Avoids "bright window, dead room".
  if(day > .01){
    cx.globalCompositeOperation='screen';
    const roomLift = cx.createLinearGradient(0, R.floorY-20, 0, H);
    roomLift.addColorStop(0,`rgba(190,205,205,${(.030*day).toFixed(3)})`);
    roomLift.addColorStop(.55,`rgba(180,190,185,${(.055*day).toFixed(3)})`);
    roomLift.addColorStop(1,`rgba(150,155,150,${(.020*day).toFixed(3)})`);
    cx.fillStyle=roomLift;
    cx.fillRect(0, R.floorY-30, W, H-R.floorY+30);
  }

  // 3. Sunset warmth should travel across the floor, not just sit on the glass.
  if(sunset > .01){
    cx.globalCompositeOperation='screen';
    const warm = cx.createLinearGradient(x, y+h, x+w*.92, H);
    warm.addColorStop(0,`rgba(255,160,90,${(.13*sunset).toFixed(3)})`);
    warm.addColorStop(.45,`rgba(180,80,120,${(.06*sunset).toFixed(3)})`);
    warm.addColorStop(1,'transparent');
    cx.fillStyle=warm;
    cx.fillRect(0, y+h-10, W, H-y-h+10);
  }

  // 4. Re-anchor darkness at the edges so day doesn't flatten the whole room.
  if(day > .01 || sunset > .01){
    cx.globalCompositeOperation='multiply';
    const edge = cx.createRadialGradient(W*.5, H*.46, 90, W*.5, H*.50, 395);
    edge.addColorStop(0,'rgba(255,255,255,1)');
    edge.addColorStop(.62,'rgba(245,245,245,1)');
    edge.addColorStop(1,`rgba(55,50,65,${(.22*day + .16*sunset).toFixed(3)})`);
    cx.fillStyle=edge;
    cx.fillRect(0,0,W,H);
  }

  cx.restore();
}

function drawTimeOfDayRoomLight(){
  // v0.35: most room lighting has moved into drawWindowLightSpill(), which is placed
  // before the hero objects so daylight feels like it enters the room rather than
  // sitting as a glowing rectangle on top of everything. This late pass is now only
  // a tiny tonal glue layer.
  const tp=timeProfile();
  if(tp.day<.01 && tp.sunset<.01) return;

  cx.save();
  cx.globalCompositeOperation='screen';
  const glue=cx.createLinearGradient(0,R.floorY,0,H);
  glue.addColorStop(0,rgbaMix([190,205,205,.010],[255,165,110,.018],[0,0,0,0]));
  glue.addColorStop(.70,rgbaMix([175,185,180,.018],[210,95,120,.022],[0,0,0,0]));
  glue.addColorStop(1,'transparent');
  cx.fillStyle=glue;
  cx.fillRect(0,R.floorY-8,W,H-R.floorY+8);
  cx.restore();
}

function drawWeatherAtmosphere(){
  if(!(S.weather.mist || S.weather.thunderstorm)) return;
  cx.save(); cx.globalCompositeOperation='screen';
  const tp=timeProfile();
  if(S.weather.mist){
    const a=.032 + .013*tp.day;
    const g=cx.createLinearGradient(0,R.win.y,0,R.floorY+80); g.addColorStop(0,'rgba(220,230,255,'+a+')'); g.addColorStop(.6,'rgba(170,190,230,'+(a*.55)+')'); g.addColorStop(1,'transparent'); cx.fillStyle=g; cx.fillRect(0,R.win.y,W,R.floorY+80);
  }
  if(S.weather.thunderstorm){
    const wind=clamp(S.stormWind||0,0,1);
    const shade=cx.createLinearGradient(0,0,0,H);
    shade.addColorStop(0,'rgba(55,70,105,.055)');
    shade.addColorStop(.55,'rgba(30,35,70,.035)');
    shade.addColorStop(1,'transparent');
    cx.fillStyle=shade; cx.fillRect(0,0,W,H);
    cx.save(); cx.beginPath(); cx.rect(R.win.x,R.win.y,R.win.w,R.win.h); cx.clip();
    cx.globalCompositeOperation='screen';
    for(let i=0;i<32;i++){
      const xx=R.win.x+((i*29+S.t*(34+i%7)*(.8+wind))%R.win.w);
      const yy=R.win.y+((i*53+S.t*(18+i%5)*(.7+wind))%R.win.h);
      cx.strokeStyle='rgba(210,230,255,'+(.018+wind*.020)+')';
      cx.lineWidth=.55;
      cx.beginPath(); cx.moveTo(xx,yy); cx.lineTo(xx-18-wind*22,yy+2+wind*6); cx.stroke();
    }
    cx.restore();
  }
  cx.restore();
}

function drawSnowLayering(){
  if(!S.weather.snow) return;
  const {x,y,w,h}=R.win; cx.save(); cx.beginPath(); cx.rect(x,y,w,h); cx.clip(); cx.globalCompositeOperation='screen';
  snowFlakes.forEach(f=>{
    f.y+=f.spd*.0035; f.x+=Math.sin(S.t*.7+f.drift)*.0007;
    if(f.y>1.08){f.y=-.05; f.x=Math.random();}
    if(f.x<-.05)f.x=1.05; if(f.x>1.05)f.x=-.05;
    const rx=x+f.x*w, ry=y+f.y*h;
    cx.fillStyle='rgba(235,245,255,'+f.a+')';
    cx.beginPath(); cx.arc(rx,ry,f.r,0,Math.PI*2); cx.fill();
  });
  cx.restore();
}

function drawLeanOutSnow(){
  if(!S.weather.snow || (S.leanAnim||0)<.02) return;
  const a=clamp(S.leanAnim||0,0,1); cx.save(); cx.globalAlpha=a; cx.globalCompositeOperation='screen';
  snowFlakes.forEach((f,i)=>{ const rx=((f.x*W)+Math.sin(S.t*.7+f.drift)*30+i*3)%W; const ry=((f.y*H)+S.t*(8+f.spd*40)+i*17)%H; cx.fillStyle='rgba(235,245,255,'+(f.a*.75)+')'; cx.beginPath(); cx.arc(rx,ry,f.r*1.15,0,Math.PI*2); cx.fill(); });
  cx.restore();
}


// ── HUSH OS v0.35 MATERIAL OVERLAYS ─────────────────────────────

function boot(){
  cacheUiRefs();
  setupDevPanel();
  updateLivingTime(.016,true);
  refreshClockDom();
  const init=UI.init || document.getElementById('init');
  const start=()=>{
    init.classList.add('gone');
    setTimeout(()=>init.style.display='none',950);
    initAudio();
  };
  init.addEventListener('click',start,{once:true});
  document.addEventListener('keydown',()=>{if(!S.audioReady)start()},{once:true});

  document.addEventListener('mousemove',e=>{
    if(UI.cur){
      UI.cur.style.left=e.clientX+'px';
      UI.cur.style.top=e.clientY+'px';
    }
    S.mx=(e.clientX/innerWidth)*2-1;
    S.my=(e.clientY/innerHeight)*2-1;

    S.hover=!S.focus?hitTest(e.clientX,e.clientY):null;
    const lbl=document.getElementById('label');
    if(S.hover){lbl.textContent=S.hover.label;lbl.style.color=S.hover.col;lbl.classList.add('show');}
    else lbl.classList.remove('show');

    // Cursor context class
    if(UI.cur){
      const ctxMap={lamp:'ctx-lamp',radio:'ctx-radio',tv:'ctx-tv',window:'ctx-window',clock:'ctx-tv',holo:'ctx-holo'};
      UI.cur.className=(S.hover?(ctxMap[S.hover.id]||''):'')+' '+(S.hover?'hover':'');
    }
  });

  function canvasPoint(e){
    const r=cv.getBoundingClientRect();
    return {x:(e.clientX-r.left)/SCALE,y:(e.clientY-r.top)/SCALE};
  }
  function pointInLamp(e){
    const p=canvasPoint(e);
    return p.x>=R.lamp.x-78 && p.x<=R.lamp.x+78 && p.y>=R.lamp.y-105 && p.y<=R.lamp.y+24;
  }

  document.addEventListener('pointerdown',e=>{
    if(e.target.closest && e.target.closest('#focusUi,#back')) return;
    if(!S.focus && pointInLamp(e)){
      e.preventDefault();
      toggleLamp();
    }
    // Cursor click flash
    if(UI.cur){ UI.cur.classList.add('click'); setTimeout(()=>UI.cur&&UI.cur.classList.remove('click'),120); }
  },true);

  function radioTuneFromEvent(e){
    const p=canvasPoint(e);
    const tx=clamp((p.x-(R.radio.x+66))/28,0,2);
    tuneRadioTo(tx,true);
    S.radioWasDragged=true;
  }

  cv.addEventListener('pointerdown',e=>{
    if(S.focus!=='radio') return;
    const p=canvasPoint(e);
    const inTuner=p.x>=R.radio.x+58 && p.x<=R.radio.x+116 && p.y>=R.radio.y+6 && p.y<=R.radio.y+28;
    const inKnobs=p.x>=R.radio.x+56 && p.x<=R.radio.x+114 && p.y>=R.radio.y+24 && p.y<=R.radio.y+46;
    if(inTuner||inKnobs){
      e.preventDefault();
      S.radioDrag=true;
      S.radioWasDragged=false;
      radioTuneFromEvent(e);
      cv.setPointerCapture?.(e.pointerId);
    }
  });
  cv.addEventListener('pointermove',e=>{
    if(!S.radioDrag) return;
    e.preventDefault();
    radioTuneFromEvent(e);
  });
  cv.addEventListener('pointerup',e=>{
    if(!S.radioDrag) return;
    e.preventDefault();
    S.radioDrag=false;
    tuneRadioTo(Math.round(S.radioTuneTarget));
    setTimeout(()=>{S.radioWasDragged=false;},80);
  });


  cv.addEventListener('click',e=>{
    const hs=hitTest(e.clientX,e.clientY);

    // v0.35 bug fix: the time-of-day UI is controlled only by the physical clock.
    // Clicking the window, TV, radio, lamp, or empty room always closes it.
    if(!hs || hs.id!=='clock') closeTimeController();

    if(!S.focus && hs && hs.id==='clock'){
      toggleTimeController();
      return;
    }

    // When the holocube is already focused, allow a click anywhere on the canvas to cycle it.
    if(S.focus==='holo'){
      activateHolocube();
      return;
    }
    if(S.focus==='tv'){
      cycleTVChannel();
      return;
    }
    if(S.focus==='radio'){
      if(S.radioWasDragged){S.radioWasDragged=false; return;}
      tuneRadioTo((Math.round(S.radioTuneTarget)+1)%3);
      return;
    }
    if(S.focus)return;
    if(pointInLamp(e)) return;
    if(!hs)return;
    if(hs.id==='lamp'){
      toggleLamp();
      return;
    }
    if(hs.id==='holo'){
      activateHolocube();
      return;
    }
    setFocus(hs.id);
  });

  document.getElementById('back').addEventListener('click',()=>setFocus(null));
  cv.addEventListener('dblclick',()=>{
    if(S.focus==='tv') cycleTVChannel();
    if(S.focus==='holo'){activateHolocube();}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')setFocus(null)});

  // Radio
  document.getElementById('rPow').addEventListener('click',()=>{
    S.radioOn=!S.radioOn;
    document.getElementById('rPow').classList.toggle('on',S.radioOn);
    if(S.audioReady)ramp('radio',S.radioOn?S.radioVol*stGain():0,.35);
  });
  document.querySelectorAll('[data-st]').forEach(el=>el.addEventListener('click',()=>{
    tuneRadioTo(+el.dataset.st);
  }));
  document.getElementById('rVol').addEventListener('input',e=>{
    S.radioVol=e.target.value/100;
    if(S.audioReady&&S.radioOn)ramp('radio',S.radioVol*stGain(),.15);
  });

  // TV
  document.getElementById('tPow').addEventListener('click',()=>{
    setTVPower(!S.tvOn);
    // TV hum intentionally disabled
  });
  document.querySelectorAll('[data-ch]').forEach(el=>el.addEventListener('click',()=>{
    S.tvCh=+el.dataset.ch;
    playMicroClick('soft');
    S.tvFlicker=.35;
    S.tvBloom=.32;
    document.querySelectorAll('[data-ch]').forEach(n=>n.classList.toggle('on',n===el));
  }));

  // Window
  document.getElementById('winTog').addEventListener('click',()=>{
    S.winAnimHold=S.winOpen;
    S.winEngageTimer=.11;
    playMicroClick('hard');
    playAirShift();
    S.winOpen=!S.winOpen; S.glowDirty=true;
    if(!S.winOpen){
      S.windowLean=false;
      document.getElementById('winLean').textContent='LEAN OUT';
      if(S.focus==='window') applyFocusZoom('window');
    }
    S.winAirPulse=1;
    S.winHandleJiggle=1;
    document.getElementById('winTog').textContent=S.winOpen?'CLOSE WINDOW':'OPEN WINDOW';
    updateAmbience(.8)
  });
  document.getElementById('winLean').addEventListener('click',()=>{
    S.winAnimHold=S.winOpen;
    S.winEngageTimer=.08;
    playMicroClick('soft');
    playAirShift();
    S.windowLean=!S.windowLean;
    if(S.windowLean && !S.winOpen){
      S.winOpen=true;
      document.getElementById('winTog').textContent='CLOSE WINDOW';
    }
    S.winAirPulse=.65;
    S.winHandleJiggle=.6;
    document.getElementById('winLean').textContent=S.windowLean?'LEAN BACK':'LEAN OUT';
    if(S.focus==='window') applyFocusZoom('window');
    updateAmbience(.5);
  });

  function playLampFlicker(){
    if(!S.audioReady || !AC) return;
    const now=AC.currentTime;
    const g=AC.createGain();
    g.gain.setValueAtTime(0.0001,now);
    g.gain.exponentialRampToValueAtTime(0.025,now+0.015);
    g.gain.exponentialRampToValueAtTime(0.0001,now+0.12);
    const o=AC.createOscillator();
    o.type='triangle';
    o.frequency.setValueAtTime(S.lampOn?420:190,now);
    o.frequency.exponentialRampToValueAtTime(S.lampOn?680:120,now+0.08);
    o.connect(g);
    g.connect(AC.destination);
    o.start(now);
    o.stop(now+0.13);
  }

  function toggleLamp(){
    S.lampOn=!S.lampOn; S.glowDirty=true;
    S.lampFlk=S.lampOn?1.55:0;
    playLampFlicker();
    const lbl=document.getElementById('label');
    lbl.textContent=S.lampOn?'[ LAMP ON ]':'[ LAMP OFF ]';
    lbl.style.color='#ffd49a';
    lbl.classList.add('show');
    clearTimeout(S.lampLabelTimer);
    S.lampLabelTimer=setTimeout(()=>{ if(!S.hover) lbl.classList.remove('show'); },900);
  }

  document.querySelectorAll('[data-mood]').forEach(el=>el.addEventListener('click',()=>setMood(el.dataset.mood)));
  document.querySelectorAll('[data-weather]').forEach(el=>el.addEventListener('click',()=>toggleWeather(el.dataset.weather)));
  document.querySelectorAll('[data-time]').forEach(el=>el.addEventListener('click',(e)=>{
    e.stopPropagation();
    const panel=document.getElementById('timeUi');
    // v0.35 safety guard: invisible time chips must never capture clicks.
    // Time can only change when the physical clock has explicitly opened this panel.
    if(!panel || !panel.classList.contains('show')) return;
    setTimeOfDay(el.dataset.time);
    closeTimeController();
  }));
  document.addEventListener('click',(e)=>{ if(!e.target.closest('#timeUi,#dev-panel') && e.target!==cv) closeTimeController(); });

  // Lamp is intentionally controlled only by clicking the lamp itself.

  requestAnimationFrame(render);
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',boot,{once:true});}else{boot();}
