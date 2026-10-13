/* ============================================================
   KeySprint - app.js
   Shared behaviour and demo authentication for every page.

   SECTIONS
     [1]  HELPERS        - validation, hashing, ids, page paths
     [2]  ACCOUNTS       - register, log in, log out, sessions
     [3]  ROUTE GUARD    - protected and guest-only pages
     [4]  THEME & NAV    - theme, reduced motion, navigation bar
     [5]  FORMS          - login and register form behaviour
     [6]  PROFILE        - profile stats, editing, local reset
     [7]  PRACTICE       - time, passage and custom text tests
     [8]  RESULTS        - results page, comparison, feedback
     [9]  DASHBOARD      - stats, level, streak, weekly chart, recent tests
     [10] PROGRESS       - 7-day trends, mode comparison, session history
     [11] SETTINGS       - theme, motion, practice defaults, history reset
     [12] START          - runs everything when the page loads

   DEMO AUTH: passwords are hashed with PBKDF2 and a random salt, and
   are never stored in plain text. Data stays in this browser only, so
   this is NOT production security.
   ============================================================ */
(function () {
  'use strict';

  var storage = window.KS.storage;
  var KEYS = storage.KEYS;

  var SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  var PBKDF2_ITERATIONS = 100000;
  var MIN_PASSWORD_LENGTH = 8;
  var GENERIC_LOGIN_ERROR = 'Email or password is incorrect.';
  var GUEST_PAGES = ['login', 'register'];
  var STRENGTH_LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];

  var BIO_MAX_LENGTH = 160;
  var NAME_MAX_LENGTH = 60;
  var DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
  var DURATIONS = [120, 300, 600, 900, 1200];
  var DEFAULT_DURATION = 300;

  var PRACTICE_MODES = ['time', 'passage', 'custom'];
  var CUSTOM_DURATIONS = [600, 900, 1200];
  var CUSTOM_MAX_WORDS = 4000;
  var CUSTOM_MAX_LENGTH = 24000;
  var LONG_TEST_MIN_SECONDS = 600;
  var WORD_GOAL = 2000;

  var NAV_ITEMS = [
    { id: 'dashboard', href: 'dashboard.html', label: 'Dashboard' },
    { id: 'practice',  href: 'practice.html',  label: 'Practice' },
    { id: 'results',   href: 'results.html',   label: 'Results' },
    { id: 'progress',  href: 'progress.html',  label: 'Progress' },
    { id: 'profile',   href: 'profile.html',   label: 'Profile' },
    { id: 'settings',  href: 'settings.html',  label: 'Settings' }
  ];

  /* ============================================================
     [1] HELPERS
     ============================================================ */

  function pagePath(fileName) {
    var inPagesFolder = window.location.pathname.indexOf('/pages/') !== -1;
    return (inPagesFolder ? '' : 'pages/') + fileName;
  }

  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += ('0' + bytes[i].toString(16)).slice(-2);
    }
    return hex;
  }

  function hexToBytes(hex) {
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function createSalt() {
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }

  async function hashPassword(password, saltHex) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('This browser does not support password hashing.');
    }
    var keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    var bits = await window.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: hexToBytes(saltHex),
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );
    return bytesToHex(new Uint8Array(bits));
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function hasCapitalLetters(email) {
    return /[A-Z]/.test(email);
  }

  function getPasswordStrength(password) {
    var score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
    return { score: score, label: STRENGTH_LABELS[score] };
  }

  /* ============================================================
     [2] ACCOUNTS
     ============================================================ */

  function readUsers() {
    return storage.read(KEYS.users).value;
  }

  function findUserByEmail(users, email) {
    var target = normalizeEmail(email);
    var ids = Object.keys(users);
    for (var i = 0; i < ids.length; i++) {
      var user = users[ids[i]];
      if (user && normalizeEmail(user.email) === target) {
        return user;
      }
    }
    return null;
  }

  function startSession(userId) {
    return storage.write(KEYS.session, { userId: userId, startedAt: Date.now() });
  }

  function getValidSession() {
    var session = storage.read(KEYS.session).value;
    var shapeOk = session &&
      typeof session.userId === 'string' &&
      typeof session.startedAt === 'number';

    if (!shapeOk) {
      if (session !== null) storage.remove(KEYS.session);
      return null;
    }

    var users = readUsers();
    var userExists = Object.prototype.hasOwnProperty.call(users, session.userId) &&
      Boolean(users[session.userId]);
    var expired = Date.now() - session.startedAt > SESSION_MAX_AGE_MS;

    if (!userExists || expired) {
      storage.remove(KEYS.session);
      return null;
    }
    return { userId: session.userId, user: users[session.userId] };
  }

  async function registerAccount(name, email, password) {
    var users = readUsers();
    var normalized = normalizeEmail(email);

    if (findUserByEmail(users, normalized)) {
      return {
        ok: false,
        field: 'reg-email',
        message: 'An account with this email already exists. Try logging in instead.'
      };
    }

    var salt = createSalt();
    var hash = await hashPassword(password, salt);
    var id = createId();

    users[id] = {
      id: id,
      name: name.trim(),
      email: normalized,
      passwordSalt: salt,
      passwordHash: hash,
      bio: '',
      createdAt: new Date().toISOString(),
      preferences: { difficulty: 'intermediate', duration: DEFAULT_DURATION }
    };

    if (!storage.write(KEYS.users, users)) {
      return {
        ok: false,
        field: null,
        message: 'Your account could not be saved. Browser storage may be full or disabled.'
      };
    }

    startSession(id);
    return { ok: true, user: users[id] };
  }

  async function loginAccount(email, password) {
    var user = findUserByEmail(readUsers(), email);
    if (!user || !user.passwordSalt || !user.passwordHash) {
      return { ok: false, message: GENERIC_LOGIN_ERROR };
    }

    var hash = await hashPassword(password, user.passwordSalt);
    if (hash !== user.passwordHash) {
      return { ok: false, message: GENERIC_LOGIN_ERROR };
    }

    startSession(user.id);
    return { ok: true, user: user };
  }

  function logout() {
    storage.remove(KEYS.session);
    window.location.replace(pagePath('login.html'));
  }

  /* ============================================================
     [3] ROUTE GUARD
     ============================================================ */

  function runRouteGuard() {
    var page = document.body.getAttribute('data-page');
    var session = getValidSession();

    if (page === 'index') {
      window.location.replace(pagePath(session ? 'dashboard.html' : 'login.html'));
      return true;
    }
    if (GUEST_PAGES.indexOf(page) !== -1 && session) {
      window.location.replace(pagePath('dashboard.html'));
      return true;
    }
    if (document.body.getAttribute('data-protected') === 'true' && !session) {
      window.location.replace(pagePath('login.html'));
      return true;
    }
    return false;
  }

  /* ============================================================
     [4] THEME & NAV
     ============================================================ */

  function applyTheme(theme) {
    var safeTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', safeTheme);
  }

  function applyReducedMotion(enabled) {
    document.documentElement.classList.toggle('reduce-motion', Boolean(enabled));
  }

  function renderNav(activeId, session) {
    var nav = document.getElementById('site-nav');
    if (!nav) return;

    var list = document.createElement('ul');
    list.className = 'nav-list';

    NAV_ITEMS.forEach(function (item) {
      var li = document.createElement('li');
      var link = document.createElement('a');
      link.href = item.href;
      link.className = 'nav-link';
      link.textContent = item.label;
      if (item.id === activeId) {
        link.setAttribute('aria-current', 'page');
      }
      li.appendChild(link);
      list.appendChild(li);
    });

    if (session) {
      var logoutItem = document.createElement('li');
      var logoutButton = document.createElement('button');
      logoutButton.type = 'button';
      logoutButton.className = 'btn btn-secondary';
      logoutButton.id = 'logout-button';
      logoutButton.textContent = 'Log out';
      logoutButton.addEventListener('click', logout);
      logoutItem.appendChild(logoutButton);
      list.appendChild(logoutItem);
    }

    nav.innerHTML = '';
    nav.appendChild(list);
  }

  /* ============================================================
     [5] FORMS
     ============================================================ */

  function setFieldError(inputId, message) {
    var input = document.getElementById(inputId);
    var error = document.getElementById(inputId + '-error');
    if (!input || !error) return;

    if (message) {
      error.textContent = message;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    } else {
      error.textContent = '';
      error.hidden = true;
      input.setAttribute('aria-invalid', 'false');
    }
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('.field-error').forEach(function (el) {
      setFieldError(el.id.replace(/-error$/, ''), '');
    });
  }

  function showFormAlert(type, message) {
    var container = document.getElementById('form-alert');
    if (!container) return;
    container.innerHTML = '';
    if (!message) return;

    var box = document.createElement('div');
    box.className = 'alert alert-' + type;
    box.setAttribute('role', type === 'error' ? 'alert' : 'status');
    box.textContent = message;
    container.appendChild(box);
  }

  function isSubmitting(form) {
    return form.getAttribute('data-submitting') === 'true';
  }

  function setSubmitting(form, isBusy, label) {
    var button = form.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = isBusy;
    button.textContent = label;
    form.setAttribute('data-submitting', String(isBusy));
  }

  function bindPasswordToggles() {
    document.querySelectorAll('[data-toggle-password]').forEach(function (button) {
      button.addEventListener('click', function () {
        var input = document.getElementById(button.getAttribute('data-toggle-password'));
        if (!input) return;
        var showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        button.textContent = showing ? 'Show' : 'Hide';
        button.setAttribute('aria-pressed', String(!showing));
      });
    });
  }

  function bindLoginForm() {
    var form = document.getElementById('login-form');
    if (!form) return;

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (isSubmitting(form)) return;

      clearFieldErrors(form);
      showFormAlert('error', '');

      var email = document.getElementById('login-email').value;
      var password = document.getElementById('login-password').value;
      var valid = true;

      if (!email.trim()) {
        setFieldError('login-email', 'Please enter your email address.');
        valid = false;
      } else if (hasCapitalLetters(email)) {
        setFieldError('login-email', 'Email must be in lowercase. Please retype it without capital letters.');
        valid = false;
      } else if (!isValidEmail(normalizeEmail(email))) {
        setFieldError('login-email', 'Enter a valid email address, such as name@example.com.');
        valid = false;
      }

      if (!password) {
        setFieldError('login-password', 'Please enter your password.');
        valid = false;
      }

      if (!valid) return;

      setSubmitting(form, true, 'Logging in...');
      try {
        var result = await loginAccount(email, password);
        if (result.ok) {
          showFormAlert('success', 'Logged in. Taking you to your dashboard...');
          window.location.replace(pagePath('dashboard.html'));
          return;
        }
        showFormAlert('error', result.message);
      } catch (err) {
        showFormAlert('error', 'Something went wrong while logging in. Please try again.');
      }
      setSubmitting(form, false, 'Log in');
    });
  }

  function bindRegisterForm() {
    var form = document.getElementById('register-form');
    if (!form) return;

    var passwordInput = document.getElementById('reg-password');
    var hint = document.getElementById('reg-password-hint');

    passwordInput.addEventListener('input', function () {
      var value = passwordInput.value;
      if (!value) {
        hint.textContent = 'Use at least ' + MIN_PASSWORD_LENGTH + ' characters. Mixing letter cases, numbers and symbols makes it stronger.';
        return;
      }
      hint.textContent = 'Strength: ' + getPasswordStrength(value).label + '.';
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (isSubmitting(form)) return;

      clearFieldErrors(form);
      showFormAlert('error', '');

      var name = document.getElementById('reg-name').value.trim();
      var email = document.getElementById('reg-email').value;
      var password = passwordInput.value;
      var confirm = document.getElementById('reg-confirm').value;
      var valid = true;

      if (!name) {
        setFieldError('reg-name', 'Please enter your full name.');
        valid = false;
      } else if (name.length > NAME_MAX_LENGTH) {
        setFieldError('reg-name', 'Name must be ' + NAME_MAX_LENGTH + ' characters or fewer.');
        valid = false;
      }

      if (!email.trim()) {
        setFieldError('reg-email', 'Please enter your email address.');
        valid = false;
      } else if (hasCapitalLetters(email)) {
        setFieldError('reg-email', 'Email must be in lowercase. Please retype it without capital letters.');
        valid = false;
      } else if (!isValidEmail(normalizeEmail(email))) {
        setFieldError('reg-email', 'Enter a valid email address, such as name@example.com.');
        valid = false;
      }

      if (!password) {
        setFieldError('reg-password', 'Please create a password.');
        valid = false;
      } else if (password.length < MIN_PASSWORD_LENGTH) {
        setFieldError('reg-password', 'Password must be at least ' + MIN_PASSWORD_LENGTH + ' characters.');
        valid = false;
      }

      if (!confirm) {
        setFieldError('reg-confirm', 'Please confirm your password.');
        valid = false;
      } else if (confirm !== password) {
        setFieldError('reg-confirm', 'Passwords do not match.');
        valid = false;
      }

      if (!valid) return;

      setSubmitting(form, true, 'Creating account...');
      try {
        var result = await registerAccount(name, email, password);
        if (result.ok) {
          showFormAlert('success', 'Account created. Taking you to your dashboard...');
          window.location.replace(pagePath('dashboard.html'));
          return;
        }
        if (result.field) {
          setFieldError(result.field, result.message);
        } else {
          showFormAlert('error', result.message);
        }
      } catch (err) {
        showFormAlert('error', err.message || 'Your account could not be created. Please try again.');
      }
      setSubmitting(form, false, 'Create account');
    });
  }

  /* ============================================================
     [6] PROFILE
     ============================================================ */

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function getCurrentUser() {
    var session = getValidSession();
    return session ? session.user : null;
  }

  function getInitials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    var first = parts[0].charAt(0);
    var last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + last).toUpperCase();
  }

  function formatDate(isoString) {
    var date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function getUserSessions(userId) {
    var all = storage.read(KEYS.sessions).value;
    var list = all && Array.isArray(all[userId]) ? all[userId] : [];
    return list.filter(function (record) {
      return record &&
        typeof record.netWpm === 'number' &&
        typeof record.accuracy === 'number' &&
        typeof record.durationSeconds === 'number';
    });
  }

  function computeStats(records) {
    if (records.length === 0) return null;
    var best = 0;
    var accuracySum = 0;
    var totalSeconds = 0;
    records.forEach(function (record) {
      if (record.netWpm > best) best = record.netWpm;
      accuracySum += record.accuracy;
      totalSeconds += record.durationSeconds;
    });
    return {
      bestWpm: Math.round(best),
      avgAccuracy: Math.round(accuracySum / records.length),
      sessions: records.length,
      totalMinutes: Math.round(totalSeconds / 60)
    };
  }

  function renderStats(userId) {
    var stats = computeStats(getUserSessions(userId));
    setText('stat-best-wpm', stats ? String(stats.bestWpm) : '—');
    setText('stat-avg-accuracy', stats ? stats.avgAccuracy + '%' : '—');
    setText('stat-sessions', stats ? String(stats.sessions) : '0');
    setText('stat-practice-time', stats ? stats.totalMinutes + ' min' : '0 min');
  }

  function renderProfileHeader(user) {
    setText('profile-avatar', getInitials(user.name));
    setText('profile-display-name', user.name);
    setText('profile-email', user.email);
    setText('profile-joined', formatDate(user.createdAt));
  }

  function updateBioCount() {
    var bio = document.getElementById('profile-bio');
    if (!bio) return;
    setText('profile-bio-count', bio.value.length + ' / ' + BIO_MAX_LENGTH + ' characters');
  }

  function fillProfileForm(user) {
    var prefs = user.preferences || {};
    var difficulty = DIFFICULTIES.indexOf(prefs.difficulty) !== -1 ? prefs.difficulty : 'intermediate';
    var duration = DURATIONS.indexOf(prefs.duration) !== -1 ? prefs.duration : DEFAULT_DURATION;

    document.getElementById('profile-name').value = user.name;
    document.getElementById('profile-bio').value = user.bio || '';
    document.getElementById('profile-difficulty').value = difficulty;
    document.getElementById('profile-duration').value = String(duration);
    updateBioCount();
  }

  function bindResetDialog() {
    var openButton = document.getElementById('reset-open');
    var modal = document.getElementById('reset-modal');
    var cancelButton = document.getElementById('reset-cancel');
    var confirmButton = document.getElementById('reset-confirm');
    if (!openButton || !modal) return;

    function closeModal() {
      modal.hidden = true;
      openButton.focus();
    }

    openButton.addEventListener('click', function () {
      modal.hidden = false;
      cancelButton.focus();
    });
    cancelButton.addEventListener('click', closeModal);
    confirmButton.addEventListener('click', function () {
      storage.resetAll();
      window.location.replace(pagePath('login.html'));
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) closeModal();
    });
  }

  function bindProfilePage() {
    var form = document.getElementById('profile-form');
    if (!form) return;

    var user = getCurrentUser();
    if (!user) return;

    var bio = document.getElementById('profile-bio');

    renderProfileHeader(user);
    renderStats(user.id);
    fillProfileForm(user);

    bio.addEventListener('input', updateBioCount);

    document.getElementById('profile-cancel').addEventListener('click', function () {
      clearFieldErrors(form);
      showFormAlert('info', 'Changes discarded.');
      fillProfileForm(getCurrentUser());
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearFieldErrors(form);
      showFormAlert('error', '');

      var name = document.getElementById('profile-name').value.trim();
      var bioText = bio.value.trim();
      var difficulty = document.getElementById('profile-difficulty').value;
      var duration = Number(document.getElementById('profile-duration').value);
      var valid = true;

      if (!name) {
        setFieldError('profile-name', 'Please enter your full name.');
        valid = false;
      } else if (name.length > NAME_MAX_LENGTH) {
        setFieldError('profile-name', 'Name must be ' + NAME_MAX_LENGTH + ' characters or fewer.');
        valid = false;
      }

      if (bioText.length > BIO_MAX_LENGTH) {
        setFieldError('profile-bio', 'Bio must be ' + BIO_MAX_LENGTH + ' characters or fewer.');
        valid = false;
      }

      if (DIFFICULTIES.indexOf(difficulty) === -1 || DURATIONS.indexOf(duration) === -1) {
        showFormAlert('error', 'Please choose a valid difficulty and test duration.');
        valid = false;
      }

      if (!valid) return;

      var users = storage.read(KEYS.users).value;
      var saved = users[user.id];
      if (!saved) {
        showFormAlert('error', 'Your account could not be found. Please log in again.');
        return;
      }

      saved.name = name;
      saved.bio = bioText;
      saved.preferences = { difficulty: difficulty, duration: duration };

      if (!storage.write(KEYS.users, users)) {
        showFormAlert('error', 'Changes could not be saved. Browser storage may be full or disabled.');
        return;
      }

      renderProfileHeader(saved);
      showFormAlert('success', 'Profile saved.');
    });

    bindResetDialog();
  }

  /* ============================================================
     [7] PRACTICE
     ============================================================ */

  var PASSAGES = {
    beginner: [
      'The cat sat on the mat. The sun is up and the day is warm. We can walk to the park and see the birds.',
      'I like to read a book by the window. Tea is hot and the room is quiet. Small steps help us learn.',
      'Good food makes a good day. Eat fresh fruit and drink plenty of water. Rest well at night.'
    ],
    intermediate: [
      'Typing well takes patience, steady practice, and good posture. Keep your eyes on the screen, not on your fingers, and let your hands find the keys.',
      'A clear plan helps you finish work on time. Break large tasks into small steps, check your progress often, and celebrate each finished part.',
      'Reading every day builds vocabulary, focus, and imagination. Choose books that interest you, and make time for them even on busy evenings.'
    ],
    advanced: [
      'Quantum computing, however, is not merely "faster": qubits (not bits) exploit superposition, entanglement, and interference, so 2^n states can be explored at once.',
      "Dr. Ahmed's report (Q3, 2025) estimated a 12.5% rise in throughput; the margin of error was +/-3.2%, so conclusions must remain cautious. See Table 4-B.",
      'Parsing JSON safely requires: validating input; handling nulls; catching exceptions; and never trusting user data, especially when it crosses network or storage boundaries.'
    ]
  };

  var TIME_TEXT_BUFFER = 80;
  var MIN_TEST_SECONDS = 1;
  var TIMER_TICK_MS = 250;

  var practice = null;
  var practiceTimer = null;

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function normalizeCharacter(ch) {
    if (ch === '\u201C' || ch === '\u201D') return '"';
    if (ch === '\u2018' || ch === '\u2019') return "'";
    return ch;
  }

  function isSameCharacter(a, b) {
    return normalizeCharacter(a) === normalizeCharacter(b);
  }

  function countWords(text) {
    var trimmed = String(text || '').trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  function formatDuration(seconds) {
    if (seconds >= 60 && seconds % 60 === 0) {
      return (seconds / 60) + ' min';
    }
    return seconds + ' s';
  }

  function formatClock(seconds) {
    var whole = Math.max(0, Math.floor(seconds));
    var minutes = Math.floor(whole / 60);
    var secs = whole % 60;
    return minutes + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function pickPassage(difficulty) {
    var list = PASSAGES[difficulty];
    return list[Math.floor(Math.random() * list.length)];
  }

  function createRun(mode, difficulty, durationSeconds, customText) {
    var wordGoal = null;
    if (mode === 'time' && durationSeconds >= LONG_TEST_MIN_SECONDS) {
      wordGoal = WORD_GOAL;
    } else if (mode === 'custom') {
      wordGoal = countWords(customText);
    }

    return {
      mode: mode,
      difficulty: difficulty,
      durationSeconds: durationSeconds,
      timed: mode === 'time' || mode === 'custom',
      timeUp: false,
      target: mode === 'custom' ? customText : pickPassage(difficulty),
      typed: '',
      inserted: 0,
      backspaces: 0,
      correctKeystrokes: 0,
      status: 'idle',
      startedAt: null,
      finishedAt: null,
      saved: false,
      wordGoal: wordGoal,
      spans: []
    };
  }

  function ensureRunTextLength(run) {
    if (run.mode !== 'time') return;
    while (run.target.length - run.typed.length < TIME_TEXT_BUFFER) {
      run.target += ' ' + pickPassage(run.difficulty);
    }
  }

  function readPracticeSetup() {
    var mode = document.getElementById('practice-mode').value;
    var difficulty = document.getElementById('practice-difficulty').value;
    var duration = Number(document.getElementById('practice-duration').value);

    if (PRACTICE_MODES.indexOf(mode) === -1 ||
        DIFFICULTIES.indexOf(difficulty) === -1 ||
        DURATIONS.indexOf(duration) === -1) {
      return null;
    }
    var rawCustom = document.getElementById('practice-custom-text').value;
    return {
      mode: mode,
      difficulty: difficulty,
      duration: duration,
      customText: rawCustom.replace(/\s+/g, ' ').trim()
    };
  }

  function setSetupLocked(locked) {
    ['practice-mode', 'practice-duration', 'practice-difficulty', 'practice-custom-text', 'practice-start'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = locked;
    });
  }

  function setPracticeInputEnabled(enabled) {
    var input = document.getElementById('practice-input');
    if (input) input.disabled = !enabled;
  }

  function keepCurrentCharacterVisible(container, run) {
    var current = run.spans[run.typed.length];
    if (!current || container.clientHeight === 0) return;

    var top = current.offsetTop;
    var bottom = top + current.offsetHeight;
    var viewTop = container.scrollTop;
    var viewBottom = viewTop + container.clientHeight;

    if (top < viewTop || bottom > viewBottom) {
      container.scrollTop = Math.max(0, top - container.clientHeight / 3);
    }
  }

  function renderPracticeText(run, fromIndex, toIndex) {
    var container = document.getElementById('practice-text');
    if (!container) return;

    if (run.spans.length === 0) {
      container.innerHTML = '';
    }

    while (run.spans.length < run.target.length) {
      var span = document.createElement('span');
      span.textContent = run.target.charAt(run.spans.length);
      span.className = 'char-untyped';
      run.spans.push(span);
      container.appendChild(span);
    }

    var last = Math.min(toIndex, run.target.length - 1);
    for (var i = Math.max(0, fromIndex); i <= last; i++) {
      var el = run.spans[i];
      if (i < run.typed.length) {
        el.className = isSameCharacter(run.typed.charAt(i), run.target.charAt(i))
          ? 'char-correct'
          : 'char-incorrect';
      } else if (i === run.typed.length) {
        el.className = 'char-current';
      } else {
        el.className = 'char-untyped';
      }
    }

    keepCurrentCharacterVisible(container, run);
  }

  function showPlaceholderText(message) {
    var container = document.getElementById('practice-text');
    if (container) container.textContent = message;
  }

  function updateProgress(run) {
    if (run.mode !== 'time') {
      setText('practice-progress', run.typed.length + ' / ' + run.target.length + ' characters');
    } else {
      setText('practice-progress', run.typed.length + ' characters typed');
    }

    var wordLine = document.getElementById('practice-wordcount');
    if (!wordLine) return;

    if (run.wordGoal) {
      var words = countWords(run.typed);
      var percent = Math.min(100, Math.floor((words / run.wordGoal) * 100));
      wordLine.hidden = false;
      wordLine.textContent = 'Words: ' + words + ' of ' + run.wordGoal + ' (' + percent + '%)';
    } else {
      wordLine.hidden = true;
    }
  }

  function stopPracticeTimer() {
    if (practiceTimer !== null) {
      clearInterval(practiceTimer);
      practiceTimer = null;
    }
  }

  function tickPractice() {
    var run = practice;
    if (!run || run.status !== 'running') return;

    var elapsed = (Date.now() - run.startedAt) / 1000;

    if (run.timed) {
      var remaining = Math.max(0, run.durationSeconds - elapsed);
      setText('practice-timer', 'Time left: ' + formatClock(Math.ceil(remaining)));
      if (remaining <= 0) {
        run.timeUp = true;
        finishRun(run);
      }
    } else {
      setText('practice-timer', 'Time: ' + Math.floor(elapsed) + ' s');
    }
  }

  function startRun(run) {
    run.status = 'running';
    run.startedAt = Date.now();
    setSetupLocked(true);
    stopPracticeTimer();
    practiceTimer = setInterval(tickPractice, TIMER_TICK_MS);
    tickPractice();
  }

  function onPracticeInput(input) {
    var run = practice;
    if (!run || run.status === 'finished') {
      if (run) input.value = run.typed;
      return;
    }

    var next = input.value;
    if (run.mode !== 'time' && next.length > run.target.length) {
      next = next.slice(0, run.target.length);
    }

    var prev = run.typed;
    var common = 0;
    while (common < prev.length && common < next.length && prev.charAt(common) === next.charAt(common)) {
      common++;
    }

    var removed = prev.length - common;
    var inserted = next.slice(common);

    if (inserted.length > 0 && run.status === 'idle') {
      startRun(run);
    }

    run.backspaces += removed;
    for (var i = 0; i < inserted.length; i++) {
      run.inserted++;
      if (isSameCharacter(inserted.charAt(i), run.target.charAt(common + i))) {
        run.correctKeystrokes++;
      }
    }

    run.typed = next;
    input.value = next;
    ensureRunTextLength(run);
    renderPracticeText(run, common, Math.max(prev.length, next.length));
    updateProgress(run);

    if (run.mode !== 'time' && run.typed.length >= run.target.length) {
      finishRun(run);
    }
  }

  function computeMetrics(run, elapsedSeconds) {
    if (run.inserted === 0) return null;

    var totalKeystrokes = run.inserted + run.backspaces;
    var minutes = Math.max(elapsedSeconds, MIN_TEST_SECONDS) / 60;
    var grossWpm = (run.inserted / 5) / minutes;

    var uncorrectedErrors = 0;
    for (var i = 0; i < run.typed.length; i++) {
      if (!isSameCharacter(run.typed.charAt(i), run.target.charAt(i))) uncorrectedErrors++;
    }

    var netWpm = Math.max(0, grossWpm - uncorrectedErrors / minutes);
    var accuracy = totalKeystrokes > 0 ? (run.correctKeystrokes / totalKeystrokes) * 100 : 0;

    return {
      elapsedSeconds: round1(elapsedSeconds),
      grossWpm: round1(grossWpm),
      netWpm: round1(netWpm),
      accuracy: round1(accuracy),
      correctKeystrokes: run.correctKeystrokes,
      incorrectAttempts: totalKeystrokes - run.correctKeystrokes,
      totalKeystrokes: totalKeystrokes,
      uncorrectedErrors: uncorrectedErrors,
      typedCharacters: run.typed.length
    };
  }

  function saveSession(userId, run, metrics) {
    var all = storage.read(KEYS.sessions).value;
    if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};

    var list = Array.isArray(all[userId]) ? all[userId] : [];
    list.push({
      id: createId(),
      mode: run.mode,
      difficulty: run.difficulty,
      durationSeconds: metrics.elapsedSeconds,
      grossWpm: metrics.grossWpm,
      netWpm: metrics.netWpm,
      accuracy: metrics.accuracy,
      correctKeystrokes: metrics.correctKeystrokes,
      incorrectAttempts: metrics.incorrectAttempts,
      totalKeystrokes: metrics.totalKeystrokes,
      uncorrectedErrors: metrics.uncorrectedErrors,
      typedCharacters: metrics.typedCharacters,
      completedAt: new Date(run.finishedAt).toISOString()
    });

    all[userId] = list;
    return storage.write(KEYS.sessions, all);
  }

  function finishRun(run) {
    if (run.status === 'finished') return;

    run.status = 'finished';
    run.finishedAt = Date.now();
    stopPracticeTimer();
    setPracticeInputEnabled(false);
    setSetupLocked(false);

    var elapsed = run.timeUp
      ? run.durationSeconds
      : (run.finishedAt - run.startedAt) / 1000;

    var metrics = computeMetrics(run, elapsed);
    if (!metrics) {
      showFormAlert('info', 'No valid typing was recorded, so this test was not saved.');
      return;
    }

    var user = getCurrentUser();
    if (!user) {
      showFormAlert('error', 'Your session has ended. Please log in again to save this result.');
      return;
    }

    if (!run.saved) {
      run.saved = true;
      if (!saveSession(user.id, run, metrics)) {
        showFormAlert('error', 'This result could not be saved. Browser storage may be full or disabled.');
        return;
      }
    }

    setText('practice-timer', 'Test finished. Opening your results...');
    window.location.replace(pagePath('results.html'));
  }

  function startFromSetup() {
    var user = getCurrentUser();
    if (!user) {
      showFormAlert('error', 'Your session has ended. Please log in again.');
      return;
    }

    var setup = readPracticeSetup();
    if (!setup) {
      showFormAlert('error', 'Please choose a valid mode, duration and difficulty.');
      return;
    }

    if (setup.mode === 'custom') {
      if (!setup.customText) {
        showFormAlert('error', 'Please paste or type the text you want to practise.');
        return;
      }

      var wordTotal = countWords(setup.customText);
      if (wordTotal > CUSTOM_MAX_WORDS) {
        showFormAlert('error', 'Your text has ' + wordTotal + ' words. The limit is ' + CUSTOM_MAX_WORDS + ' words. Please shorten it.');
        return;
      }

      if (setup.customText.length > CUSTOM_MAX_LENGTH) {
        showFormAlert('error', 'Your text is ' + setup.customText.length + ' characters. The limit is ' + CUSTOM_MAX_LENGTH + ' characters. Please shorten it.');
        return;
      }
    }

    showFormAlert('error', '');
    stopPracticeTimer();
    practice = createRun(setup.mode, setup.difficulty, setup.duration, setup.customText);
    ensureRunTextLength(practice);

    var input = document.getElementById('practice-input');
    input.value = '';
    setPracticeInputEnabled(true);
    renderPracticeText(practice, 0, practice.target.length - 1);
    updateProgress(practice);
    setText('practice-timer', 'Start typing to begin the timer.');
    input.focus();
  }

  function resetToSetup() {
    stopPracticeTimer();
    practice = null;
    setSetupLocked(false);
    setPracticeInputEnabled(true);
    document.getElementById('practice-input').value = '';
    showPlaceholderText('Choose a test and press Start test.');
    setText('practice-timer', 'Start typing to begin the timer.');
    setText('practice-progress', '');
    var wordLine = document.getElementById('practice-wordcount');
    if (wordLine) wordLine.hidden = true;
    document.getElementById('practice-start').focus();
  }

  function pickAllowed(value, allowed, fallback) {
    return allowed.indexOf(value) !== -1 ? value : fallback;
  }

  function syncDurationOptions() {
    var select = document.getElementById('practice-duration');
    var isCustom = document.getElementById('practice-mode').value === 'custom';

    Array.prototype.forEach.call(select.options, function (option) {
      var allowed = !isCustom || CUSTOM_DURATIONS.indexOf(Number(option.value)) !== -1;
      option.disabled = !allowed;
      option.hidden = !allowed;
    });

    if (isCustom && CUSTOM_DURATIONS.indexOf(Number(select.value)) === -1) {
      select.value = String(CUSTOM_DURATIONS[0]);
    }
  }

  function applySetupFromUrl(prefs) {
    var params = new URLSearchParams(window.location.search);
    var mode = pickAllowed(params.get('mode'), PRACTICE_MODES, 'time');
    var difficulty = pickAllowed(params.get('difficulty'), DIFFICULTIES,
      pickAllowed(prefs.difficulty, DIFFICULTIES, 'intermediate'));
    var duration = pickAllowed(Number(params.get('duration')), DURATIONS,
      pickAllowed(prefs.duration, DURATIONS, DEFAULT_DURATION));

    document.getElementById('practice-mode').value = mode;
    document.getElementById('practice-difficulty').value = difficulty;
    document.getElementById('practice-duration').value = String(duration);
  }

  function bindPracticePage() {
    var input = document.getElementById('practice-input');
    if (!input) return;

    var user = getCurrentUser();
    if (!user) return;

    var prefs = user.preferences || {};
    var modeSelect = document.getElementById('practice-mode');
    var durationField = document.getElementById('practice-duration-field');
    var restartModal = document.getElementById('restart-modal');
    var restartButton = document.getElementById('practice-restart');
    var restartCancel = document.getElementById('restart-cancel');
    var restartConfirm = document.getElementById('restart-confirm');

    applySetupFromUrl(prefs);

    function updateDurationVisibility() {
      var customField = document.getElementById('practice-custom-field');
      durationField.hidden = modeSelect.value === 'passage';
      customField.hidden = modeSelect.value !== 'custom';
      syncDurationOptions();
    }
    modeSelect.addEventListener('change', updateDurationVisibility);
    updateDurationVisibility();

    document.getElementById('practice-start').addEventListener('click', startFromSetup);

    input.addEventListener('input', function () {
      onPracticeInput(input);
    });

    ['paste', 'drop'].forEach(function (eventName) {
      input.addEventListener(eventName, function (event) {
        event.preventDefault();
        showFormAlert('info', 'Pasting is turned off during practice. Please type the text.');
      });
    });

    function closeRestartModal() {
      restartModal.hidden = true;
      restartButton.focus();
    }

    restartButton.addEventListener('click', function () {
      if (practice && practice.status === 'running') {
        restartModal.hidden = false;
        restartCancel.focus();
      } else {
        startFromSetup();
      }
    });
    restartCancel.addEventListener('click', closeRestartModal);
    restartConfirm.addEventListener('click', function () {
      restartModal.hidden = true;
      startFromSetup();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !restartModal.hidden) closeRestartModal();
    });

    window.addEventListener('beforeunload', function (event) {
      if (practice && practice.status === 'running') {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    window.addEventListener('pagehide', stopPracticeTimer);
  }

  /* ============================================================
     [8] RESULTS
     ============================================================ */

  function getLatestRecord(userId) {
    var list = getUserSessions(userId);
    return list.length ? list[list.length - 1] : null;
  }

  function getPreviousBest(userId) {
    var list = getUserSessions(userId);
    if (list.length < 2) return null;
    var best = 0;
    list.slice(0, -1).forEach(function (record) {
      if (record.netWpm > best) best = record.netWpm;
    });
    return best;
  }

  function buildComparison(netWpm, previousBest) {
    if (previousBest === null) {
      return 'This is your first saved test, so it becomes your baseline.';
    }
    if (netWpm > previousBest) {
      return 'New personal best! Your previous best was ' + previousBest.toFixed(1) + ' WPM.';
    }
    return 'Your personal best is ' + previousBest.toFixed(1) + ' WPM.';
  }

  function buildFeedback(record) {
    var message;
    if (record.accuracy < 90) {
      message = 'Accuracy is below 90%. Slow down slightly and focus on hitting the correct keys before raising your speed.';
    } else if (record.accuracy < 95) {
      message = 'Accuracy is good, but aim for 95% or higher before pushing your speed.';
    } else {
      message = 'Excellent accuracy. Keep building speed in small steps.';
    }
    if (record.uncorrectedErrors > 0) {
      message += ' You finished with ' + record.uncorrectedErrors + ' uncorrected error(s).';
    }
    return message;
  }

  function buildRetryHref(record) {
    var duration;
    if (record.mode === 'time') {
      duration = record.durationSeconds;
    } else if (record.mode === 'custom') {
      duration = CUSTOM_DURATIONS[0];
    } else {
      duration = DEFAULT_DURATION;
    }
    return 'practice.html?mode=' + encodeURIComponent(record.mode) +
      '&difficulty=' + encodeURIComponent(record.difficulty) +
      '&duration=' + encodeURIComponent(duration);
  }

  function renderResults(record, previousBest) {
    setText('res-net', record.netWpm.toFixed(1));
    setText('res-gross', record.grossWpm.toFixed(1));
    setText('res-accuracy', record.accuracy.toFixed(1) + '%');
    setText('res-correct', String(record.correctKeystrokes));
    setText('res-incorrect', String(record.incorrectAttempts));
    setText('res-duration', Math.round(record.durationSeconds) + ' s');
    setText('res-mode', formatMode(record));
    setText('res-difficulty', record.difficulty.charAt(0).toUpperCase() + record.difficulty.slice(1));
    setText('res-completed', formatDate(record.completedAt));
    setText('res-previous', buildComparison(record.netWpm, previousBest));
    setText('res-feedback', buildFeedback(record));

    var retry = document.getElementById('res-retry');
    if (retry) retry.setAttribute('href', buildRetryHref(record));
  }

  function bindResultsPage() {
    var content = document.getElementById('results-content');
    var empty = document.getElementById('results-empty');
    if (!content || !empty) return;

    var user = getCurrentUser();
    if (!user) return;

    var record = getLatestRecord(user.id);
    if (!record) {
      content.hidden = true;
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    content.hidden = false;
    renderResults(record, getPreviousBest(user.id));
  }

  /* ============================================================
     [9] DASHBOARD
     ============================================================ */

  var WEEK_DAYS = 7;
  var RECENT_TESTS_SHOWN = 5;

  var LEVEL_BANDS = [
    { min: 60, label: 'Advanced' },
    { min: 40, label: 'Intermediate' },
    { min: 20, label: 'Developing' },
    { min: 0,  label: 'Beginner' }
  ];

  function titleCase(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  function localDateKey(date) {
    var month = ('0' + (date.getMonth() + 1)).slice(-2);
    var day = ('0' + date.getDate()).slice(-2);
    return date.getFullYear() + '-' + month + '-' + day;
  }

  function sortByDate(records) {
    return records.slice().sort(function (a, b) {
      return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
    });
  }

  function formatMode(record) {
    if (record.mode === 'time') return 'Time Challenge (' + formatDuration(record.durationSeconds) + ')';
    if (record.mode === 'custom') {
      return CUSTOM_DURATIONS.indexOf(record.durationSeconds) !== -1
        ? 'Custom text (' + formatDuration(record.durationSeconds) + ')'
        : 'Custom text';
    }
    return 'Passage Challenge';
  }

  function buildDashboardStats(records) {
    if (records.length === 0) return null;

    var best = 0;
    var accuracySum = 0;
    var totalSeconds = 0;
    records.forEach(function (record) {
      if (record.netWpm > best) best = record.netWpm;
      accuracySum += record.accuracy;
      totalSeconds += record.durationSeconds;
    });

    var level = LEVEL_BANDS.filter(function (band) {
      return best >= band.min;
    })[0];

    return {
      bestWpm: best,
      latestWpm: records[records.length - 1].netWpm,
      avgAccuracy: accuracySum / records.length,
      sessions: records.length,
      totalMinutes: Math.round(totalSeconds / 60),
      level: level.label
    };
  }

  function calculateStreak(records) {
    var daysWithTests = {};
    records.forEach(function (record) {
      var date = new Date(record.completedAt);
      if (!isNaN(date.getTime())) {
        daysWithTests[localDateKey(date)] = true;
      }
    });

    var cursor = new Date();
    if (!daysWithTests[localDateKey(cursor)]) {
      cursor.setDate(cursor.getDate() - 1);
    }

    var streak = 0;
    while (daysWithTests[localDateKey(cursor)]) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function buildWeek(records) {
    var today = new Date();
    var days = [];
    var indexByKey = {};

    for (var i = WEEK_DAYS - 1; i >= 0; i--) {
      var date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      var key = localDateKey(date);
      indexByKey[key] = days.length;
      days.push({
        key: key,
        label: date.toLocaleDateString(undefined, { weekday: 'short' }),
        best: null
      });
    }

    records.forEach(function (record) {
      var date = new Date(record.completedAt);
      if (isNaN(date.getTime())) return;
      var index = indexByKey[localDateKey(date)];
      if (index === undefined) return;
      if (days[index].best === null || record.netWpm > days[index].best) {
        days[index].best = record.netWpm;
      }
    });

    return days;
  }

  function formatStreak(days) {
    if (days === 0) return 'No streak yet';
    return days + (days === 1 ? ' day' : ' days');
  }

  function renderDashboardStats(stats) {
    setText('dash-level', stats ? stats.level : 'Not rated yet');
    setText('dash-best-wpm', stats ? stats.bestWpm.toFixed(1) : '—');
    setText('dash-latest-wpm', stats ? stats.latestWpm.toFixed(1) : '—');
    setText('dash-avg-accuracy', stats ? stats.avgAccuracy.toFixed(1) + '%' : '—');
    setText('dash-sessions', stats ? String(stats.sessions) : '0');
    setText('dash-practice-time', stats ? stats.totalMinutes + ' min' : '0 min');
  }

  function renderWeeklyChart(days) {
    var chart = document.getElementById('dash-chart');
    if (!chart) return;
    chart.innerHTML = '';

    var max = 0;
    days.forEach(function (day) {
      if (day.best !== null && day.best > max) max = day.best;
    });
    var scale = max > 0 ? max : 1;

    days.forEach(function (day) {
      var col = document.createElement('div');
      col.className = 'chart-col';

      var value = document.createElement('span');
      value.className = 'chart-value';
      value.textContent = day.best === null ? '' : day.best.toFixed(1);

      var track = document.createElement('div');
      track.className = 'chart-track';

      var bar = document.createElement('div');
      bar.className = 'chart-bar' + (day.best === null ? ' chart-bar-empty' : '');
      bar.style.height = day.best === null
        ? '4px'
        : Math.max(8, Math.round((day.best / scale) * 100)) + '%';
      track.appendChild(bar);

      var label = document.createElement('span');
      label.className = 'chart-label';
      label.textContent = day.label;

      col.appendChild(value);
      col.appendChild(track);
      col.appendChild(label);
      chart.appendChild(col);
    });
  }

  function describeWeek(days) {
    var logged = days.filter(function (day) {
      return day.best !== null;
    });
    if (logged.length === 0) return 'No tests in the last 7 days yet.';
    return 'Best Net WPM by day: ' + logged.map(function (day) {
      return day.label + ' ' + day.best.toFixed(1);
    }).join(', ') + '.';
  }

  function renderRecentSessions(records) {
    var table = document.getElementById('dash-recent-table');
    var body = document.getElementById('dash-recent-body');
    var empty = document.getElementById('dash-recent-empty');
    if (!table || !body || !empty) return;

    body.innerHTML = '';
    var recent = records.slice(-RECENT_TESTS_SHOWN).reverse();

    table.hidden = recent.length === 0;
    empty.hidden = recent.length > 0;

    recent.forEach(function (record) {
      var row = document.createElement('tr');
      var cells = [
        formatDate(record.completedAt),
        formatMode(record),
        titleCase(record.difficulty),
        record.netWpm.toFixed(1),
        record.accuracy.toFixed(1) + '%'
      ];
      cells.forEach(function (text) {
        var cell = document.createElement('td');
        cell.textContent = text;
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
  }

  function bindDashboardPage() {
    if (!document.getElementById('dash-greeting')) return;

    var user = getCurrentUser();
    if (!user) return;

    var records = sortByDate(getUserSessions(user.id));
    var stats = buildDashboardStats(records);
    var days = buildWeek(records);

    setText('dash-greeting', 'Welcome back, ' + String(user.name).split(' ')[0] + '.');
    renderDashboardStats(stats);
    setText('dash-streak', formatStreak(calculateStreak(records)));
    renderWeeklyChart(days);
    setText('dash-chart-summary', describeWeek(days));
    renderRecentSessions(records);
  }

  /* ============================================================
     [10] PROGRESS
     ============================================================ */

  var TREND_DAYS = 7;
  var RANGE_DAYS = { '7': 7, '30': 30, 'all': 0 };
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function average(values) {
    if (values.length === 0) return null;
    var sum = values.reduce(function (total, value) { return total + value; }, 0);
    return sum / values.length;
  }

  function maxOf(values) {
    return values.reduce(function (best, value) { return value > best ? value : best; }, 0);
  }

  function fmt1(value) {
    return typeof value === 'number' ? value.toFixed(1) : '—';
  }

  function recordsInRange(records, rangeKey) {
    var days = RANGE_DAYS[rangeKey];
    if (!days) return records;

    var start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    var startTime = start.getTime();

    return records.filter(function (record) {
      return new Date(record.completedAt).getTime() >= startTime;
    });
  }

  function renderProgressSummary(inRange, all) {
    var bestAll = all.length ? maxOf(all.map(function (r) { return r.netWpm; })) : null;
    var avgWpm = average(inRange.map(function (r) { return r.netWpm; }));
    var avgAcc = average(inRange.map(function (r) { return r.accuracy; }));
    var seconds = inRange.reduce(function (total, r) { return total + r.durationSeconds; }, 0);

    setText('prog-best-wpm', fmt1(bestAll));
    setText('prog-avg-wpm', fmt1(avgWpm));
    setText('prog-avg-accuracy', avgAcc === null ? '—' : avgAcc.toFixed(1) + '%');
    setText('prog-sessions', String(inRange.length));
    setText('prog-practice-time', Math.round(seconds / 60) + ' min');
  }

  function buildDailyTrend(records) {
    var today = new Date();
    var days = [];
    var indexByKey = {};

    for (var i = TREND_DAYS - 1; i >= 0; i--) {
      var date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      indexByKey[localDateKey(date)] = days.length;
      days.push({
        label: date.toLocaleDateString(undefined, { weekday: 'short' }),
        wpmValues: [],
        accValues: []
      });
    }

    records.forEach(function (record) {
      var date = new Date(record.completedAt);
      if (isNaN(date.getTime())) return;
      var index = indexByKey[localDateKey(date)];
      if (index === undefined) return;
      days[index].wpmValues.push(record.netWpm);
      days[index].accValues.push(record.accuracy);
    });

    return days.map(function (day) {
      return {
        label: day.label,
        wpm: average(day.wpmValues),
        accuracy: average(day.accValues)
      };
    });
  }

  function createSvg(name, attributes, text) {
    var el = document.createElementNS(SVG_NS, name);
    Object.keys(attributes).forEach(function (key) {
      el.setAttribute(key, attributes[key]);
    });
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function renderLineChart(containerId, values, labels, maxValue, suffix) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    var hasData = values.some(function (v) { return v !== null; });
    if (!hasData) {
      var note = document.createElement('p');
      note.className = 'empty-state';
      note.textContent = 'No tests in the last 7 days yet.';
      container.appendChild(note);
      return;
    }

    var width = 600;
    var height = 240;
    var padLeft = 48;
    var padRight = 16;
    var padTop = 16;
    var padBottom = 36;
    var innerWidth = width - padLeft - padRight;
    var innerHeight = height - padTop - padBottom;
    var step = innerWidth / (values.length - 1);

    var svg = createSvg('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      class: 'line-chart',
      focusable: 'false',
      'aria-hidden': 'true'
    });

    [0, 0.5, 1].forEach(function (fraction) {
      var y = padTop + innerHeight - fraction * innerHeight;
      svg.appendChild(createSvg('line', {
        x1: padLeft, x2: width - padRight, y1: y, y2: y, class: 'chart-grid'
      }));
      svg.appendChild(createSvg('text', {
        x: padLeft - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-axis-label'
      }, Math.round(maxValue * fraction) + suffix));
    });

    var path = '';
    var coords = [];
    values.forEach(function (value, i) {
      if (value === null) return;
      var x = padLeft + i * step;
      var y = padTop + innerHeight - (value / maxValue) * innerHeight;
      var connected = i > 0 && values[i - 1] !== null;
      path += (connected ? ' L ' : ' M ') + x.toFixed(1) + ' ' + y.toFixed(1);
      coords.push({ x: x, y: y });
    });

    if (path) {
      svg.appendChild(createSvg('path', { d: path.trim(), class: 'chart-line' }));
    }
    coords.forEach(function (point) {
      svg.appendChild(createSvg('circle', { cx: point.x, cy: point.y, r: 4, class: 'chart-dot' }));
    });
    labels.forEach(function (label, i) {
      svg.appendChild(createSvg('text', {
        x: padLeft + i * step, y: height - 12, 'text-anchor': 'middle', class: 'chart-axis-label'
      }, label));
    });

    var scroll = document.createElement('div');
    scroll.className = 'chart-scroll';
    scroll.appendChild(svg);
    container.appendChild(scroll);
  }

  function describeTrend(trend) {
    var logged = trend.filter(function (day) { return day.wpm !== null; });
    if (logged.length === 0) return 'No tests in the last 7 days yet.';
    return 'Average Net WPM by day: ' + logged.map(function (day) {
      return day.label + ' ' + day.wpm.toFixed(1) + ' WPM, ' + day.accuracy.toFixed(1) + '% accuracy';
    }).join('; ') + '.';
  }

  function renderTrendCharts(all) {
    var trend = buildDailyTrend(all);
    var labels = trend.map(function (day) { return day.label; });
    var wpmValues = trend.map(function (day) { return day.wpm; });
    var accValues = trend.map(function (day) { return day.accuracy; });

    var wpmPeak = maxOf(wpmValues.map(function (v) { return v === null ? 0 : v; }));
    var wpmMax = Math.max(10, Math.ceil(wpmPeak * 1.1));

    renderLineChart('prog-wpm-chart', wpmValues, labels, wpmMax, '');
    renderLineChart('prog-accuracy-chart', accValues, labels, 100, '%');
    setText('prog-trend-summary', describeTrend(trend));
  }

  function renderModeComparison(inRange) {
    var body = document.getElementById('prog-mode-body');
    if (!body) return;
    body.innerHTML = '';

    [
      { id: 'time', label: 'Time Challenge' },
      { id: 'passage', label: 'Passage Challenge' },
      { id: 'custom', label: 'Custom text' }
    ].forEach(function (mode) {
      var list = inRange.filter(function (r) { return r.mode === mode.id; });
      var wpms = list.map(function (r) { return r.netWpm; });
      var accs = list.map(function (r) { return r.accuracy; });

      var cells = [
        mode.label,
        String(list.length),
        fmt1(average(wpms)),
        wpms.length ? fmt1(maxOf(wpms)) : '—',
        accs.length ? average(accs).toFixed(1) + '%' : '—'
      ];

      var row = document.createElement('tr');
      cells.forEach(function (text) {
        var cell = document.createElement('td');
        cell.textContent = text;
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
  }

  function renderHistory(inRange) {
    var table = document.getElementById('prog-history-table');
    var body = document.getElementById('prog-history-body');
    var empty = document.getElementById('prog-history-empty');
    if (!table || !body || !empty) return;

    body.innerHTML = '';
    var newestFirst = inRange.slice().reverse();

    table.hidden = newestFirst.length === 0;
    empty.hidden = newestFirst.length > 0;

    newestFirst.forEach(function (record) {
      var cells = [
        formatDate(record.completedAt),
        formatMode(record),
        titleCase(record.difficulty),
        fmt1(record.grossWpm),
        fmt1(record.netWpm),
        record.accuracy.toFixed(1) + '%',
        Math.round(record.durationSeconds) + ' s'
      ];

      var row = document.createElement('tr');
      cells.forEach(function (text) {
        var cell = document.createElement('td');
        cell.textContent = text;
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
  }

  function bindProgressPage() {
    var filter = document.getElementById('prog-range');
    if (!filter) return;

    var user = getCurrentUser();
    if (!user) return;

    var all = sortByDate(getUserSessions(user.id));

    function renderRange() {
      var inRange = recordsInRange(all, filter.value);
      renderProgressSummary(inRange, all);
      renderModeComparison(inRange);
      renderHistory(inRange);
    }

    filter.addEventListener('change', renderRange);
    renderTrendCharts(all);
    renderRange();
  }

  /* ============================================================
     [11] SETTINGS
     ============================================================ */

  function readAppSettings() {
    return storage.read(KEYS.settings).value;
  }

  function saveAppSettings(patch) {
    var current = readAppSettings();
    var next = {};
    Object.keys(current).forEach(function (key) { next[key] = current[key]; });
    Object.keys(patch).forEach(function (key) { next[key] = patch[key]; });

    applyTheme(next.theme);
    applyReducedMotion(next.reducedMotion);
    return storage.write(KEYS.settings, next);
  }

  function savePracticeDefaults(userId, difficulty, duration) {
    var users = readUsers();
    var saved = users[userId];
    if (!saved) return false;

    saved.preferences = { difficulty: difficulty, duration: duration };
    return storage.write(KEYS.users, users);
  }

  function clearUserProgress(userId) {
    var all = storage.read(KEYS.sessions).value;
    if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};

    delete all[userId];
    return storage.write(KEYS.sessions, all);
  }

  function fillSettingsForm(user) {
    var app = readAppSettings();
    var prefs = user.preferences || {};

    document.getElementById('set-theme').value = app.theme === 'light' ? 'light' : 'dark';
    document.getElementById('set-reduced-motion').checked = Boolean(app.reducedMotion);
    document.getElementById('set-difficulty').value =
      pickAllowed(prefs.difficulty, DIFFICULTIES, 'intermediate');
    document.getElementById('set-duration').value =
      String(pickAllowed(prefs.duration, DURATIONS, DEFAULT_DURATION));
  }

  function bindSettingsPreview() {
    document.getElementById('set-theme').addEventListener('change', function (event) {
      applyTheme(event.target.value);
    });
    document.getElementById('set-reduced-motion').addEventListener('change', function (event) {
      applyReducedMotion(event.target.checked);
    });
  }

  function bindSettingsForm(user) {
    var form = document.getElementById('settings-form');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      showFormAlert('error', '');

      var theme = document.getElementById('set-theme').value;
      var reducedMotion = document.getElementById('set-reduced-motion').checked;
      var difficulty = document.getElementById('set-difficulty').value;
      var duration = Number(document.getElementById('set-duration').value);

      if (theme !== 'dark' && theme !== 'light') {
        showFormAlert('error', 'Please choose a valid theme.');
        return;
      }
      if (DIFFICULTIES.indexOf(difficulty) === -1 || DURATIONS.indexOf(duration) === -1) {
        showFormAlert('error', 'Please choose a valid difficulty and test duration.');
        return;
      }

      var appSaved = saveAppSettings({ theme: theme, reducedMotion: reducedMotion });
      var prefsSaved = savePracticeDefaults(user.id, difficulty, duration);

      if (!appSaved || !prefsSaved) {
        showFormAlert('error', 'Settings could not be saved. Browser storage may be full or disabled.');
        return;
      }
      showFormAlert('success', 'Settings saved.');
    });
  }

  function bindSettingsReset(user) {
    var openButton = document.getElementById('set-reset-open');
    var modal = document.getElementById('set-reset-modal');
    var cancelButton = document.getElementById('set-reset-cancel');
    var confirmButton = document.getElementById('set-reset-confirm');

    function closeModal() {
      modal.hidden = true;
      openButton.focus();
    }

    openButton.addEventListener('click', function () {
      modal.hidden = false;
      cancelButton.focus();
    });
    cancelButton.addEventListener('click', closeModal);
    confirmButton.addEventListener('click', function () {
      modal.hidden = true;
      if (clearUserProgress(user.id)) {
        showFormAlert('success', 'Your practice history has been cleared. Your account and settings are unchanged.');
      } else {
        showFormAlert('error', 'Practice history could not be cleared. Please try again.');
      }
      openButton.focus();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) closeModal();
    });
  }

  function bindSettingsPage() {
    var form = document.getElementById('settings-form');
    if (!form) return;

    var user = getCurrentUser();
    if (!user) return;

    fillSettingsForm(user);
    bindSettingsPreview();
    bindSettingsForm(user);
    bindSettingsReset(user);
  }

  /* ============================================================
     [12] START
     ============================================================ */

  function init() {
    var settings = storage.read(KEYS.settings).value;
    applyTheme(settings.theme);
    applyReducedMotion(settings.reducedMotion);

    if (runRouteGuard()) return;

    if (document.body.getAttribute('data-nav') !== 'none') {
      renderNav(document.body.getAttribute('data-page'), getValidSession());
    }

    bindPasswordToggles();
    bindLoginForm();
    bindRegisterForm();
    bindProfilePage();
    bindPracticePage();
    bindResultsPage();
    bindDashboardPage();
    bindProgressPage();
    bindSettingsPage();
  }

  window.KS = window.KS || {};
  window.KS.auth = {
    registerAccount: registerAccount,
    loginAccount: loginAccount,
    logout: logout,
    getValidSession: getValidSession
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();