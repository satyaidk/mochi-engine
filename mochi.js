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

  function poke() {
    reaction = REACTIONS[reactionCount % REACTIONS.length];
    reactionCount += 1;
    reactionUntil = performance.now() + 2400;
    caption.textContent = reaction;

    if (!reduceMotion.matches) {
      pet.classList.remove('is-squished');
      void pet.offsetWidth; // restart the animation
      pet.classList.add('is-squished');
    }
    schedule();
  }

  pet.addEventListener('click', poke);
  pet.addEventListener('animationend', function () {
    pet.classList.remove('is-squished');
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
})();
