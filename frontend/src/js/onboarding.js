// Onboarding — first-run welcome screen

function showOnboarding() {
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');

  // Wire browse buttons
  const browseDir = document.getElementById('onbBrowseDir');
  const browseMpv = document.getElementById('onbBrowseMpv');
  if (browseDir) browseDir.onclick = () => browseOnbFolder('onbMediaDir');
  if (browseMpv) browseMpv.onclick = () => browseOnbFile('onbMpvPath');

  // Wire skip links
  const skipDir = document.getElementById('onbSkipDir');
  const skipMpv = document.getElementById('onbSkipMpv');
  if (skipDir) skipDir.onclick = (e) => { e.preventDefault(); skipField('onbDirGroup'); };
  if (skipMpv) skipMpv.onclick = (e) => { e.preventDefault(); skipField('onbMpvGroup'); };

  // Wire submit
  const submitBtn = document.getElementById('onbStart');
  if (submitBtn) submitBtn.onclick = onSubmitOnboarding;
}

function skipField(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.classList.add('onb-field--skipped');
}

async function onSubmitOnboarding() {
  const btn = document.getElementById('onbStart');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = t('onboarding.configuring');

  const mediaDir = document.getElementById('onbMediaDir')?.value.trim();
  const mpvPath = document.getElementById('onbMpvPath')?.value.trim();
  const errEl = document.getElementById('onbError');
  if (errEl) errEl.textContent = '';
  if (errEl) errEl.classList.add('hidden');

  try {
    // Save whatever was filled (empty values = keep defaults)
    const payload = {};
    if (mediaDir) payload.mediaDir = mediaDir;
    if (mpvPath) payload.mpvPath = mpvPath;

    if (mediaDir || mpvPath) {
      await API.post('/api/config', payload);
      configCache = await API.get('/api/config');
    }

    // Dismiss welcome
    const overlay = document.getElementById('onboardingOverlay');
    if (overlay) overlay.classList.add('hidden');

    // Show discovery view for first scan
    showView('discovery');
  } catch (e) {
    if (errEl) {
      errEl.textContent = e.message || t('onboarding.saveConfigFailed');
      errEl.classList.remove('hidden');
    }
    btn.disabled = false;
    btn.textContent = t('onboarding.startUsing');
  }
}

async function browseOnbFolder(inputId) {
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: t('onboarding.selectMediaDir')
    });
    if (selected) {
      document.getElementById(inputId).value = selected;
      document.getElementById(inputId).focus();
    } else if (!window.__TAURI__) {
      showToast(t('onboarding.browserManualPath'), 'info');
    }
  } catch (e) {
    showToast(t('onboarding.selectDirFailed') + ': ' + e.message, 'error');
  }
}

async function browseOnbFile(inputId) {
  try {
    const selected = await openDialog({
      multiple: false,
      title: t('onboarding.selectMpvFile'),
      filters: [{ name: t('onboarding.executableFile'), extensions: ['exe', 'com'] }]
    });
    if (selected) {
      document.getElementById(inputId).value = selected;
      document.getElementById(inputId).focus();
    } else if (!window.__TAURI__) {
      showToast(t('onboarding.browserManualPath'), 'info');
    }
  } catch (e) {
    showToast(t('onboarding.selectFileFailed') + ': ' + e.message, 'error');
  }
}
