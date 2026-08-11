/* ==========================================================
   THE WORD NOOK — app.js
   Theme toggle · card draw (fetches your Django backend)
   · circular countdown timer, all animated with GSAP
   ========================================================== */

document.addEventListener("DOMContentLoaded", () => {

  /* ---------------------------------------------------------
     0. CONFIG — point this at your backend endpoint
  --------------------------------------------------------- */
  const GENERATE_WORD_URL = "/generate-word/";

  /* ---------------------------------------------------------
     1. THEME TOGGLE (warm light / warm dark)
  --------------------------------------------------------- */
  const root = document.documentElement;
  const themeToggle = document.getElementById("themeToggle");
  const savedTheme = localStorage.getItem("word-nook-theme");
  if (savedTheme) root.setAttribute("data-theme", savedTheme);

  themeToggle.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("word-nook-theme", next);
    gsap.fromTo(themeToggle, { rotate: -20 }, { rotate: 0, duration: .5, ease: "back.out(3)" });
  });

  /* ---------------------------------------------------------
     2. INTRO ANIMATION
  --------------------------------------------------------- */
  gsap.from(".masthead", { y: 18, opacity: 0, duration: .7, ease: "power3.out" });
  gsap.from(".card-stack", { y: 26, opacity: 0, duration: .8, delay: .15, ease: "power3.out" });
  gsap.from(".draw-btn", { y: 14, opacity: 0, duration: .6, delay: .4, ease: "power3.out" });
  gsap.from(".timer", { y: 20, opacity: 0, duration: .8, delay: .5, ease: "power3.out" });

  /* ---------------------------------------------------------
     3. WORD DECK — draw a random word from the backend
  --------------------------------------------------------- */
  const drawBtn = document.getElementById("drawBtn");
  const card = document.getElementById("card");
  const cardHint = document.getElementById("cardHint");
  const cardWord = document.getElementById("cardWord");
  const cardMeaning = document.getElementById("cardMeaning");
  const cardKicker = document.getElementById("cardKicker");
  const drawError = document.getElementById("drawError");

  let drawCount = 0;

  function splitIntoLetters(word) {
    cardWord.innerHTML = "";
    [...word].forEach((ch) => {
      const span = document.createElement("span");
      span.className = "letter";
      span.textContent = ch === " " ? "\u00A0" : ch;
      cardWord.appendChild(span);
    });
    return cardWord.querySelectorAll(".letter");
  }

  function showError(message) {
    drawError.textContent = message;
    drawError.classList.add("show");
    gsap.fromTo(drawError, { x: -4 }, { x: 0, duration: .4, ease: "elastic.out(1, .4)" });
  }

  function clearError() {
    drawError.classList.remove("show");
    drawError.textContent = "";
  }

  async function drawWord() {
    if (drawBtn.classList.contains("is-loading")) return;
    clearError();
    drawBtn.classList.add("is-loading");
    drawBtn.disabled = true;

    // little "card shuffle" tilt while we wait
    const shuffleTl = gsap.to(card, {
      rotate: -1.5, duration: .35, yoyo: true, repeat: -1, ease: "sine.inOut"
    });

    try {
      const res = await fetch(GENERATE_WORD_URL, { method: "POST" });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "Could not draw a word.");
      }

      drawCount += 1;
      cardKicker.textContent = `card ${String(drawCount).padStart(3, "0")}`;
      cardHint.style.display = "none";

      // 1. exit old content
      await new Promise((resolve) => {
        gsap.to([cardWord, cardMeaning], {
          opacity: 0, y: -8, duration: .2, ease: "power2.in", onComplete: resolve
        });
      });

      // 2. build the new letters now, so we have real element references
      //    (a string selector like ".letter" here would resolve too early
      //    and match nothing, since the spans don't exist until this point)
      const letters = splitIntoLetters(data.word);
      cardMeaning.textContent = data.meaning;
      // IMPORTANT: the exit animation above faded the CONTAINERS
      // (cardWord, cardMeaning) themselves down to opacity 0. cardMeaning
      // gets animated back up directly below, but cardWord's own opacity
      // is never touched again after this point - only its new .letter
      // children are. Without resetting the container here, the letters
      // animate to opacity 1 while sitting inside an invisible (opacity 0)
      // parent, so nothing ever becomes visible. Reset it explicitly:
      gsap.set(cardWord, { opacity: 1, y: 0 });
      gsap.set(letters, { opacity: 0, y: 14, rotate: () => gsap.utils.random(-6, 6) });
      gsap.set(cardMeaning, { opacity: 0, y: 10 });

      // 3. reveal, animating the actual elements we just created
      gsap.to(card, { rotate: gsap.utils.random(-1.2, 1.2), duration: .1 });
      gsap.to(letters, {
        opacity: 1, y: 0, rotate: 0, duration: .5, stagger: .035, ease: "back.out(1.8)"
      });
      gsap.to(cardMeaning, { opacity: 1, y: 0, duration: .5, ease: "power2.out", delay: .15 });
      gsap.to(card, { rotate: 0, duration: .4, ease: "elastic.out(1, .5)", delay: .1 });

    } catch (err) {
      showError("The deck stuck for a moment — tap to try again.");
      console.error("Word draw failed:", err);
    } finally {
      shuffleTl.kill();
      gsap.set(card, { rotate: 0 });
      drawBtn.classList.remove("is-loading");
      drawBtn.disabled = false;
    }
  }

  drawBtn.addEventListener("click", drawWord);
  document.querySelector(".card-stack").addEventListener("click", (e) => {
    if (e.target.closest(".draw-btn")) return;
    drawWord();
  });

  /* ---------------------------------------------------------
     4. TIMER — 1 to 5 minutes, circular animated dial
  --------------------------------------------------------- */
  const dialProgress = document.getElementById("dialProgress");
  const dialTime = document.getElementById("dialTime");
  const dialCaption = document.getElementById("dialCaption");
  const ticksGroup = document.getElementById("ticks");
  const minusBtn = document.getElementById("minusBtn");
  const plusBtn = document.getElementById("plusBtn");
  const stepperValue = document.getElementById("stepperValue");
  const startBtn = document.getElementById("startBtn");
  const startBtnLabel = document.getElementById("startBtnLabel");
  const resetBtn = document.getElementById("resetBtn");
  const timerStatus = document.getElementById("timerStatus");

  const MIN_MINUTES = 1;
  const MAX_MINUTES = 5;
  const CIRCUMFERENCE = 2 * Math.PI * 54; // r=54

  let minutes = 3;
  let totalSeconds = minutes * 60;
  let remaining = totalSeconds;
  let intervalId = null;
  let running = false;

  // build 5 tick marks (one per minute, up to the 5-minute max scale)
  (function buildTicks() {
    const cx = 70, cy = 70, rOuter = 62, rInner = 57;
    for (let i = 1; i <= MAX_MINUTES; i++) {
      const angle = (i / MAX_MINUTES) * 2 * Math.PI - Math.PI / 2;
      const x1 = cx + rInner * Math.cos(angle);
      const y1 = cy + rInner * Math.sin(angle);
      const x2 = cx + rOuter * Math.cos(angle);
      const y2 = cy + rOuter * Math.sin(angle);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x1.toFixed(2));
      line.setAttribute("y1", y1.toFixed(2));
      line.setAttribute("x2", x2.toFixed(2));
      line.setAttribute("y2", y2.toFixed(2));
      line.setAttribute("stroke-width", "2");
      ticksGroup.appendChild(line);
    }
  })();

  gsap.set(dialProgress, { attr: { "stroke-dasharray": CIRCUMFERENCE, "stroke-dashoffset": 0 } });

  function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = Math.floor(sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function renderStatic() {
    dialTime.textContent = formatTime(remaining);
    stepperValue.textContent = `${minutes} min`;
    dialCaption.textContent = running ? "focusing" : "minutes";
  }

  function setProgress(fraction, animated = true) {
    const offset = CIRCUMFERENCE * fraction;
    if (animated) {
      gsap.to(dialProgress, { attr: { "stroke-dashoffset": offset }, duration: .9, ease: "power1.out" });
    } else {
      gsap.set(dialProgress, { attr: { "stroke-dashoffset": offset } });
    }
  }

  function setMinutes(newMinutes) {
    minutes = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, newMinutes));
    totalSeconds = minutes * 60;
    remaining = totalSeconds;
    setProgress(0, false);
    renderStatic();
    minusBtn.disabled = minutes === MIN_MINUTES;
    plusBtn.disabled = minutes === MAX_MINUTES;
  }

  function tick() {
    remaining -= 1;
    renderStatic();
    setProgress(1 - remaining / totalSeconds);

    if (remaining <= 0) {
      finishSession();
    }
  }

  function startTimer() {
    running = true;
    startBtn.classList.add("is-running");
    startBtnLabel.textContent = "Pause";
    minusBtn.disabled = true;
    plusBtn.disabled = true;
    timerStatus.classList.remove("show");
    intervalId = setInterval(tick, 1000);
    renderStatic();
  }

  function pauseTimer() {
    running = false;
    startBtn.classList.remove("is-running");
    startBtnLabel.textContent = "Resume";
    clearInterval(intervalId);
    renderStatic();
  }

  function resetTimer() {
    running = false;
    clearInterval(intervalId);
    startBtn.classList.remove("is-running");
    startBtnLabel.textContent = "Start";
    minusBtn.disabled = minutes === MIN_MINUTES;
    plusBtn.disabled = minutes === MAX_MINUTES;
    remaining = totalSeconds;
    setProgress(0);
    renderStatic();
    timerStatus.classList.remove("show");
  }

  function finishSession() {
    running = false;
    clearInterval(intervalId);
    startBtn.classList.remove("is-running");
    startBtnLabel.textContent = "Start";
    minusBtn.disabled = minutes === MIN_MINUTES;
    plusBtn.disabled = minutes === MAX_MINUTES;

    timerStatus.textContent = "Time's up — draw a fresh word?";
    timerStatus.classList.add("show");

    gsap.timeline()
      .to(".timer-dial", { scale: 1.06, duration: .3, ease: "power2.out" })
      .to(".timer-dial", { scale: 1, duration: .5, ease: "elastic.out(1, .4)" })
      .fromTo(dialProgress, { stroke: getComputedStyle(root).getPropertyValue("--gold") },
        { stroke: getComputedStyle(root).getPropertyValue("--accent"), duration: .4, yoyo: true, repeat: 3 }, "-=.6");
  }

  minusBtn.addEventListener("click", () => { if (!running) setMinutes(minutes - 1); });
  plusBtn.addEventListener("click", () => { if (!running) setMinutes(minutes + 1); });

  startBtn.addEventListener("click", () => {
    if (remaining <= 0) resetTimer();
    running ? pauseTimer() : startTimer();
  });

  resetBtn.addEventListener("click", resetTimer);

  setMinutes(minutes);
});