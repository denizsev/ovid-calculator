/* =====================================================================
   OVID CALCULATOR — YILDIZ AKIŞI (star flow)

   The parallax layer of the sky. The nebulae, dust lanes and hero stars
   behind this are pure CSS; this canvas adds the only thing CSS cannot do
   convincingly — real depth in motion. Stars drift outward from a slowly
   wandering vanishing point, near ones sweeping several times faster than
   far ones, which is what reads as travel rather than decoration.

   Replaces a 16 MB video with roughly 5 KB of code.
   ===================================================================== */

(function(){
  var wrap=document.getElementById('skyflow'),
      cv=document.getElementById('flow-stars'), ctx=cv.getContext('2d'),
      dv=document.getElementById('flow-dust'), dtx=dv.getContext('2d');

  var mqReduce=matchMedia('(prefers-reduced-motion: reduce)'),
      lowPower=(navigator.hardwareConcurrency||4)<=4||matchMedia('(pointer:coarse)').matches;

  var W=0,H=0,cx=0,cy=0,hx=0,hy=0,dpr=1,N=0,stars=[],raf=0,last=0,T=0,vw=0,vh=0;

  /* Depth is tracked as radial progress p out from the vanishing point, in units of
     half-viewport. dp/dt = RATE*(p+CORE) -> near stars sweep ~5x faster than far ones
     (parallax), while CORE keeps the centre from clogging. ~18s from birth to exit. */
  var RATE=0.13, CORE=0.22;
  var COL=['rgba(159,231,255','rgba(248,164,95','rgba(216,238,255'];

  function sprite(c){
    var s=32,e=document.createElement('canvas');e.width=e.height=s;
    var g=e.getContext('2d'),r=s/2,q=g.createRadialGradient(r,r,0,r,r,r);
    q.addColorStop(0,'rgba(255,255,255,1)');
    q.addColorStop(.20,'rgba(255,255,255,.95)');
    q.addColorStop(.34,c+',.80)');
    q.addColorStop(.52,c+',.28)');
    q.addColorStop(.76,c+',.06)');
    q.addColorStop(1,c+',0)');
    g.fillStyle=q;g.fillRect(0,0,s,s);return e;
  }
  var SP=[sprite(COL[0]),sprite(COL[1]),sprite(COL[2])];

  function spawn(s,p){
    var a=Math.random()*6.2832;
    s.ca=Math.cos(a); s.sa=Math.sin(a); s.p=p;
    s.r=0.55+Math.random()*Math.random()*1.75;      // biased small, a few hero stars
    s.v=0.80+Math.random()*0.50;                    // per-star speed jitter
    s.m=0.42+Math.random()*0.58;                    // magnitude
    var q=Math.random();
    s.c = q<0.055 ? 1 : (q<0.34 ? 0 : 2);           // 5.5% amber, 28% cyan, rest pale
    s.px=-9999;
  }

  function size(){
    var w=innerWidth|0, h=innerHeight|0;
    if(w===vw&&h===vh) return false;
    vw=w; vh=h;
    dpr=Math.min(devicePixelRatio||1, lowPower?1.5:1.75);
    W=w; H=h; hx=W*0.5; hy=H*0.5;
    [cv,dv].forEach(function(c){
      c.width=Math.round(W*dpr); c.height=Math.round(H*dpr);
      c.getContext('2d').setTransform(dpr,0,0,dpr,0,0);
    });
    N=Math.max(150, Math.min(lowPower?200:420, Math.round(W*H/3000)));
    if(stars.length>N) stars.length=N;
    for(var i=0;i<N;i++){
      if(!stars[i]) stars[i]={};
      spawn(stars[i], 0.02+Math.random()*1.12);     // seed across the whole journey
    }
    dust();
    return true;
  }

  /* static deep field – painted once per resize, zero per-frame cost */
  function dust(){
    dtx.clearRect(0,0,W,H);
    var n=Math.max(140, Math.min(380, Math.round(W*H/5200)));
    for(var i=0;i<n;i++){
      var x=Math.random()*W, y=Math.random()*H,
          a=.05+Math.random()*Math.random()*.30,
          r=.35+Math.random()*.75,
          c=Math.random()<.06?COL[1]:(Math.random()<.3?COL[0]:COL[2]);
      dtx.fillStyle=c+','+a.toFixed(3)+')';
      dtx.beginPath(); dtx.arc(x,y,r,0,6.2832); dtx.fill();
    }
  }

  function frame(dt){
    T+=dt;
    // ship drifts a touch: vanishing point wanders, star tracks curve gently
    cx=W*0.5+Math.sin(T*0.107)*W*0.020;
    cy=H*0.5+Math.cos(T*0.079)*H*0.016;

    ctx.clearRect(0,0,W,H);
    ctx.globalCompositeOperation='lighter';
    ctx.lineCap='round';

    for(var i=0;i<N;i++){
      var s=stars[i];
      if(dt) s.p+=(s.p+CORE)*RATE*s.v*dt;

      var p=s.p, X=cx+s.ca*p*hx, Y=cy+s.sa*p*hy;
      if(X<-70||X>W+70||Y<-70||Y>H+70){ spawn(s,0.012+Math.random()*0.03); continue; }

      var a=s.m*Math.min(1,p*7);                    // fade in over the first ~14%
      if(a<=0.004){ s.px=X; s.py=Y; continue; }
      var f=0.55+2.05*Math.pow(p<1.25?p:1.25,1.3), rad=s.r*f;

      // motion blur: only nearby stars travel far enough per frame to streak
      if(s.px>-9000){
        var ax=X-s.px, ay=Y-s.py;
        if(ax*ax+ay*ay>1.1){
          ctx.strokeStyle=COL[s.c]+','+(a*0.42).toFixed(3)+')';
          ctx.lineWidth=rad*1.15;
          ctx.beginPath(); ctx.moveTo(s.px,s.py); ctx.lineTo(X,Y); ctx.stroke();
        }
      }
      ctx.globalAlpha=a;
      var d=rad*3.7;
      ctx.drawImage(SP[s.c], X-d*0.5, Y-d*0.5, d, d);
      s.px=X; s.py=Y;
    }
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation='source-over';
  }

  function loop(now){
    raf=requestAnimationFrame(loop);
    var dt=(now-last)/1000; last=now;
    if(dt>0.05) dt=0.05;                            // clamp after stalls / tab restore
    frame(dt);
  }

  function stop(){ if(raf){cancelAnimationFrame(raf); raf=0;} }
  function start(){
    stop();
    if(mqReduce.matches){ frame(0); return; }        // static field, no RAF
    last=performance.now();
    raf=requestAnimationFrame(loop);
  }

  var pend=0;
  addEventListener('resize',function(){
    if(pend) return;
    pend=requestAnimationFrame(function(){ pend=0; if(size()) start(); });
  },{passive:true});

  document.addEventListener('visibilitychange',function(){
    document.hidden ? stop() : start();
  });
  if(mqReduce.addEventListener) mqReduce.addEventListener('change',start);
  else if(mqReduce.addListener) mqReduce.addListener(start);   // legacy signature

  size(); start();
})();
