(function () {
  'use strict';

  // Show the version from manifest.json so the page always matches what installs.
  fetch('manifest.json', { cache: 'no-cache' })
    .then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); })
    .then(function (manifest) {
      if (!manifest.version) return;
      document.querySelectorAll('[data-version]').forEach(function (el) {
        el.textContent = manifest.version;
      });
    })
    .catch(function () {});


  // ---- Mochi's face on a 128x64 one-colour "OLED" ----

  var canvas = document.getElementById('oled');
  var pet = document.getElementById('pet');
  var caption = document.getElementById('pet-caption');
  if (!canvas || !pet || !caption) return;

  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var W = canvas.width;
  var H = canvas.height;
  var GAP = 16;
  var PIXEL = [217, 242, 255];
  var OFF = [4, 5, 6];
  var HINT = caption.textContent;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Eye shapes. happy/angry/tired are how much of the eye gets carved away.
  var FACES = {
    rest:    { w: 28, h: 38, happy: 0, angry: 0, tired: 0 },
    Happy:   { w: 30, h: 36, happy: 1, angry: 0, tired: 0 },
    Angry:   { w: 30, h: 32, happy: 0, angry: 1, tired: 0 },
    Sleepy:  { w: 30, h: 16, happy: 0, angry: 0, tired: 1 },
    Excited: { w: 34, h: 44, happy: 0, angry: 0, tired: 0 }
  };
  var REACTIONS = ['Happy', 'Angry', 'Sleepy', 'Excited'];

  var cur = { x: 0, y: 0, w: 28, h: 38, happy: 0, angry: 0, tired: 0 };
  var target = { x: 0, y: 0, w: 28, h: 38, happy: 0, angry: 0, tired: 0 };

  var reaction = null;
  var reactionUntil = 0;
  var reactionCount = 0;
  var lookingAt = null;
  var blinkStart = -1;
  var nextBlink = 1200;
  var nextGlance = 900;
  var last = 0;
  var visible = true;
  var rafId = 0;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function roundRect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function triangle(ax, ay, bx, by, cx, cy) {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
  }

  function drawEye(side, blink) {
    var w = cur.w;
    var h = Math.max(2, cur.h * (1 - blink));
    var cx = W / 2 + side * (w / 2 + GAP / 2) + cur.x;
    var cy = H / 2 + cur.y;
    var x0 = cx - w / 2;
    var y0 = cy - h / 2;
    var x1 = x0 + w;
    var y1 = y0 + h;
    // For the left eye (side -1) the inner edge is on the right.
    var inner = side < 0 ? x1 + 2 : x0 - 2;
    var outer = side < 0 ? x0 - 2 : x1 + 2;

    ctx.fillStyle = '#fff';
    roundRect(x0, y0, w, h, 8);

    ctx.fillStyle = '#000';

    // Happy: a curve rises from below, leaving ^ ^ shaped eyes.
    if (cur.happy > 0.01) {
      ctx.beginPath();
      ctx.ellipse(cx, y1 + h * 0.1, w * 0.75, h * 0.8 * cur.happy, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Angry: brows slope down toward the middle.
    if (cur.angry > 0.01) {
      triangle(outer, y0 - 1, inner, y0 - 1, inner, y0 + h * 0.55 * cur.angry);
    }

    // Sleepy: lids droop at the outside corners.
    if (cur.tired > 0.01) {
      triangle(outer, y0 - 1, inner, y0 - 1, outer, y0 + h * 0.6 * cur.tired);
    }
  }

  function draw(blink) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    drawEye(-1, blink);
    drawEye(1, blink);

    // Snap to one bit per pixel, like the real SSD1306.
    var img = ctx.getImageData(0, 0, W, H);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var c = d[i] > 110 ? PIXEL : OFF;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function gazeAt(el) {
    var a = canvas.getBoundingClientRect();
    var b = el.getBoundingClientRect();
    var dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    var dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    var len = Math.hypot(dx, dy) || 1;
    target.x = (dx / len) * 12;
    target.y = (dy / len) * 6;
  }

  function frame(now) {
    rafId = 0;
    var still = reduceMotion.matches;

    if (reaction && now > reactionUntil) {
      reaction = null;
      caption.textContent = HINT;
    }

    var name = reaction || (lookingAt ? 'Happy' : 'rest');
    var face = FACES[name];
    target.w = face.w;
    target.h = face.h;
    target.happy = face.happy;
    target.angry = face.angry;
    target.tired = face.tired;

    if (lookingAt && !reaction) {
      gazeAt(lookingAt);
    } else if (reaction || still) {
      target.x = 0;
      target.y = 0;
    } else if (now > nextGlance) {
      // Most glances return to centre so the face doesn't look restless.
      var centre = Math.random() < 0.45;
      target.x = centre ? 0 : rand(-11, 11);
      target.y = centre ? 0 : rand(-4, 4);
      nextGlance = now + rand(1600, 3800);
    }

    var blink = 0;
    if (!still && name !== 'Sleepy') {
      if (blinkStart < 0 && now > nextBlink) blinkStart = now;
      if (blinkStart >= 0) {
        var t = (now - blinkStart) / 170;
        if (t >= 1) {
          blinkStart = -1;
          // Now and then, a quick double blink.
          nextBlink = now + (Math.random() < 0.2 ? 120 : rand(2400, 5600));
        } else {
          blink = t < 0.5 ? t * 2 : 2 - t * 2;
        }
      }
    }

    var k = still ? 1 : 1 - Math.exp(-Math.min(now - last, 100) / 70);
    last = now;
    for (var key in target) {
      cur[key] += (target[key] - cur[key]) * k;
    }

    draw(blink);
    schedule();
  }

  function schedule() {
    if (!rafId && visible && !document.hidden) {
      rafId = requestAnimationFrame(frame);
    }
  }

  function restartAnimation(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  function poke() {
    reaction = REACTIONS[reactionCount % REACTIONS.length];
    reactionCount += 1;
    reactionUntil = performance.now() + 2400;
    caption.textContent = reaction;

    if (!reduceMotion.matches) {
      restartAnimation(pet, 'is-squished');
      restartAnimation(caption, 'is-pop');
      burstPetals(pet);
    }
    schedule();
  }

  pet.addEventListener('click', poke);
  pet.addEventListener('animationend', function () {
    pet.classList.remove('is-squished');
  });
  caption.addEventListener('animationend', function () {
    caption.classList.remove('is-pop');
  });

  // Mochi perks up and looks over when you head for the install button.
  var installButton = document.querySelector('.install-button');
  if (installButton) {
    var lookAtInstall = function () { lookingAt = installButton; schedule(); };
    var lookAway = function () { lookingAt = null; schedule(); };
    installButton.addEventListener('pointerenter', lookAtInstall);
    installButton.addEventListener('focus', lookAtInstall);
    installButton.addEventListener('pointerleave', lookAway);
    installButton.addEventListener('blur', lookAway);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      schedule();
    }).observe(canvas);
  }

  document.addEventListener('visibilitychange', schedule);
  schedule();


  // ---- Cherry blossom petals ----
  // A few drift off the branch while the shrine is on screen;
  // poking Mochi throws a handful into the air.

  var petalCanvas = document.createElement('canvas');
  petalCanvas.className = 'petals';
  petalCanvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(petalCanvas);

  var pctx = petalCanvas.getContext('2d');
  var PETAL_COLORS = ['#FF9EBB', '#FFB8CC', '#FFD3E0', '#FF85A8'];
  var branch = document.getElementById('branch');
  var petals = [];
  var petalRaf = 0;
  var petalLast = 0;
  var dpr = 1;
  var skyVisible = true;

  function sizePetalCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    petalCanvas.width = Math.round(window.innerWidth * dpr);
    petalCanvas.height = Math.round(window.innerHeight * dpr);
  }

  function addPetal(x, y, vx, vy, wind) {
    petals.push({
      x: x,
      y: y,
      vx: vx,
      vy: vy,
      wind: wind,
      size: rand(11, 18),
      rot: rand(0, Math.PI * 2),
      spin: rand(-3, 3),
      flip: rand(0, Math.PI * 2),
      flipSpeed: rand(3, 7),
      sway: rand(0, Math.PI * 2),
      swayAmp: rand(18, 46),
      fall: rand(45, 85),
      color: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)]
    });
    if (!petalRaf) {
      petalLast = performance.now();
      petalRaf = requestAnimationFrame(stepPetals);
    }
  }

  function burstPetals(el) {
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height * 0.35;
    for (var i = 0; i < 42; i++) {
      var angle = rand(-Math.PI * 0.95, -Math.PI * 0.05); // an upward fan
      var speed = rand(220, 520);
      addPetal(cx + rand(-20, 20), cy + rand(-10, 10),
        Math.cos(angle) * speed, Math.sin(angle) * speed, rand(-10, 20));
    }
  }

  function driftPetal() {
    if (!branch) return;
    var r = branch.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return;
    addPetal(rand(Math.max(r.left, 0), r.right), r.top + rand(r.height * 0.2, r.height * 0.7),
      0, rand(20, 50), rand(15, 40));
  }

  function drawPetal(p) {
    var s = p.size;
    pctx.save();
    pctx.translate(p.x * dpr, p.y * dpr);
    pctx.rotate(p.rot);
    pctx.scale(dpr * Math.cos(p.flip), dpr); // tumbling over as it falls
    pctx.beginPath();
    pctx.moveTo(0, s * 0.55);
    pctx.bezierCurveTo(-s * 0.62, s * 0.2, -s * 0.52, -s * 0.5, -s * 0.14, -s * 0.5);
    pctx.lineTo(0, -s * 0.3);
    pctx.lineTo(s * 0.14, -s * 0.5);
    pctx.bezierCurveTo(s * 0.52, -s * 0.5, s * 0.62, s * 0.2, 0, s * 0.55);
    pctx.fillStyle = p.color;
    pctx.fill();
    pctx.restore();
  }

  function stepPetals(now) {
    var dt = Math.min((now - petalLast) / 1000, 0.05);
    petalLast = now;
    pctx.clearRect(0, 0, petalCanvas.width, petalCanvas.height);

    for (var i = petals.length - 1; i >= 0; i--) {
      var p = petals[i];
      // Thrown petals slow down, then settle into the same gentle fall.
      p.vx *= Math.pow(0.25, dt);
      if (p.vy < p.fall) {
        p.vy = Math.min(p.fall, p.vy + 600 * dt);
      } else {
        p.vy += (p.fall - p.vy) * Math.min(1, dt * 3);
      }
      p.sway += dt * 2.2;
      p.x += (p.vx + p.wind + Math.sin(p.sway) * p.swayAmp) * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.flip += p.flipSpeed * dt;

      if (p.y > window.innerHeight + 30 || p.x < -40 || p.x > window.innerWidth + 40) {
        petals.splice(i, 1);
        continue;
      }
      drawPetal(p);
    }

    petalRaf = petals.length ? requestAnimationFrame(stepPetals) : 0;
  }

  sizePetalCanvas();
  window.addEventListener('resize', sizePetalCanvas);

  var sky = document.querySelector('.sky');
  if (sky && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      skyVisible = entries[0].isIntersecting;
    }).observe(sky);
  }

  setInterval(function () {
    if (skyVisible && !document.hidden && !reduceMotion.matches && petals.length < 40) {
      driftPetal();
    }
  }, 900);


  // ---- Pause the mecha and ramen loops while they're off screen ----

  if ('IntersectionObserver' in window) {
    var pauser = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle('is-paused', !entry.isIntersecting);
      });
    });
    document.querySelectorAll('.bay, .stall').forEach(function (el) {
      pauser.observe(el);
    });
  }
})();
