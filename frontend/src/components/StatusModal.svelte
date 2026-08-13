<script>
  // ─── StatusModal（Svelte 迁移 Chunk B）───
  // 基于 Mylist.svelte 的组件内状态弹窗（逻辑 + 模板），不基于 vanilla mylist.js。
  // 只认 props，不 fetch、不查 window.libraryData/mylistData。
  import { tr, api, coverSrc, localDateStr, todayStr } from '../lib/anime-utils.js';
  import { STATUS_LABELS } from '../lib/sort.js';
  import { showToast } from './Toast.svelte';

  let {
    open = $bindable(false),
    item,
    anime = null,
    onSaved = null,
  } = $props();

  // ─── 状态 ───
  let status = $state('wish');
  let statusDdOpen = $state(false);
  let ratingVal = $state('—');
  let progressVal = $state('—');
  let startSeg = $state({ y: '', m: '', d: '' });
  let endSeg = $state({ y: '', m: '', d: '' });
  let notes = $state('');
  let statusModalTitle = $state('');
  let statusModalBg = $state('');

  // open 变 true 时重初始化
  $effect(() => {
    if (!open) return;
    const it = item || {};
    const src = anime || it;

    status = it.status ?? it.myListStatus ?? 'wish';
    statusDdOpen = false;

    statusModalTitle = src.bangumiTitle || src.title || tr('mylist.markStatus', '标记状态');
    statusModalBg = coverSrc(src, 600);

    const rating = it.userRating != null ? it.userRating : '';
    ratingVal = rating !== '' ? String(rating) : '—';

    const storedProgress = it.progress != null ? it.progress : null;
    const watchedCount = src.episodes ? src.episodes.filter((e) => e.watched).length : 0;
    const progVal = storedProgress != null ? storedProgress : watchedCount || '';
    progressVal = progVal !== '' ? String(progVal) : '—';

    const storedStart = it.startedAt ? it.startedAt : null;
    const firstPlayed = it.firstPlayedAt ? localDateStr(it.firstPlayedAt) : null;
    setDateToSegments(startSeg, storedStart ? storedStart.substring(0, 10) : firstPlayed || todayStr());

    const storedEnd = it.completedAt ? it.completedAt : null;
    setDateToSegments(endSeg, storedEnd ? storedEnd.substring(0, 10) : todayStr());

    notes = it.notes || '';
  });

  function setDateToSegments(seg, dateStr) {
    if (dateStr) {
      var parts = dateStr.substring(0, 10).split('-');
      seg.y = parts[0] || '';
      seg.m = parts[1] || '';
      seg.d = parts[2] || '';
    }
  }

  function readDateSegments(seg) {
    var y = seg.y.trim();
    var m = seg.m.trim();
    var d = seg.d.trim();
    if (!y && !m && !d) return '';
    y = y.padStart(4, '0');
    m = m.padStart(2, '0') || '01';
    d = d.padStart(2, '0') || '01';
    return y + '-' + m + '-' + d;
  }

  function segAutoTab(e, seg, field) {
    const input = e.currentTarget;
    let val = input.value.replace(/\D/g, '');
    seg[field] = val;
    if (val.length >= input.maxLength) {
      const segs = input.closest('.date-segments');
      if (segs) {
        const inputs = segs.querySelectorAll('.date-seg');
        for (let i = 0; i < inputs.length; i++) {
          if (inputs[i] === input && i < inputs.length - 1) {
            inputs[i + 1].focus();
            break;
          }
        }
      }
    }
  }

  function stepperChange(field, delta, min, max, step) {
    const currentVal = field === 'ratingVal' ? ratingVal : progressVal;
    const current = currentVal === '—' ? 0 : parseFloat(currentVal) || 0;
    let newVal = Math.round((current + delta) / step) * step;
    newVal = Math.max(min, Math.min(max, newVal));
    if (field === 'ratingVal') {
      ratingVal = newVal === 0 && delta < 0 ? '—' : String(newVal);
    } else {
      progressVal = newVal === 0 && delta < 0 ? '—' : String(newVal);
    }
  }

  async function saveStatusModal() {
    const id = item && item.id;
    if (!id) return;

    const statusVal = status;
    const rating = ratingVal !== '—' ? parseFloat(ratingVal) : null;
    const progress = progressVal !== '—' ? parseInt(progressVal, 10) : null;
    const startedAt = readDateSegments(startSeg);
    const completedAt = readDateSegments(endSeg);

    const data = {
      status: statusVal,
      rating,
      progress,
      startedAt: startedAt ? startedAt + 'T00:00:00.000Z' : null,
      completedAt: completedAt ? completedAt + 'T00:00:00.000Z' : null,
      notes,
    };

    try {
      await api.put('/api/mylist/' + encodeURIComponent(id), data);
      showToast(tr('mylist.saved', '已保存'), 'success');
      open = false;
      if (onSaved) onSaved();
    } catch (e) {
      showToast(tr('mylist.saveFailed', '保存失败：{message}', { message: e.message }), 'error');
    }
  }
</script>

{#if open}
  <div class="modal-overlay show" id="svelte-statusModal" onclick={(e) => { if (e.target === e.currentTarget) open = false; }}>
    <div class="modal status-modal">
      <div class="status-modal-bg-wrap">
        <div class="status-modal-bg" id="svelte-statusModalBg" style={statusModalBg ? `background-image:url(${statusModalBg})` : ''}></div>
        <div class="status-modal-overlay"></div>
        <div class="status-modal-glass"></div>
      </div>
      <button class="status-modal-close" onclick={() => (open = false)} aria-label={tr('common.close', '关闭')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="status-modal-inner">
        <h2 class="status-modal-heading" id="svelte-statusModalTitle">{statusModalTitle}</h2>
        <div class="status-modal-body">
          <div class="field-row">
            <div class="field-cell">
              <label class="field-label">{tr('common.status', '状态')}</label>
              <div class="status-dd" id="svelte-statusDd" class:is-open={statusDdOpen}>
                <button type="button" class="status-dd-trigger" id="svelte-statusDdTrigger" onclick={(e) => { e.stopPropagation(); statusDdOpen = !statusDdOpen; }}>
                  <span class="status-dd-text" id="svelte-statusDdText">{STATUS_LABELS[status] || tr('common.wish', '计划中')}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="status-dd-chevron"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div class="status-dd-menu" id="svelte-statusDdMenu">
                  <button type="button" class="status-dd-opt" class:is-selected={status === 'watching'} onclick={() => { status = 'watching'; statusDdOpen = false; }}><svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9"/></svg><span>{tr('common.watching', '进行中')}</span><svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>
                  <button type="button" class="status-dd-opt" class:is-selected={status === 'wish'} onclick={() => { status = 'wish'; statusDdOpen = false; }}><svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg><span>{tr('common.wish', '计划中')}</span><svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>
                  <button type="button" class="status-dd-opt" class:is-selected={status === 'completed'} onclick={() => { status = 'completed'; statusDdOpen = false; }}><svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><span>{tr('common.completed', '已完成')}</span><svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>
                  <button type="button" class="status-dd-opt" class:is-selected={status === 'on_hold'} onclick={() => { status = 'on_hold'; statusDdOpen = false; }}><svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span>{tr('common.on_hold', '搁置')}</span><svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>
                  <button type="button" class="status-dd-opt" class:is-selected={status === 'dropped'} onclick={() => { status = 'dropped'; statusDdOpen = false; }}><svg class="status-dd-opt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg><span>{tr('common.dropped', '抛弃')}</span><svg class="status-dd-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>
                </div>
              </div>
            </div>
            <div class="field-cell">
              <label class="field-label">{tr('common.rating', '评分')}</label>
              <div class="num-stepper" id="svelte-ratingStepper" data-min="0" data-max="10" data-step="0.5">
                <button type="button" class="num-stepper-btn" onclick={() => stepperChange('ratingVal', -0.5, 0, 10, 0.5)}>−</button>
                <span class="num-stepper-val" id="svelte-ratingDisplay">{ratingVal}</span>
                <button type="button" class="num-stepper-btn" onclick={() => stepperChange('ratingVal', 0.5, 0, 10, 0.5)}>+</button>
              </div>
            </div>
            <div class="field-cell">
              <label class="field-label">{tr('mylist.progressEpisodes', '进度 (集)')}</label>
              <div class="num-stepper" id="svelte-progressStepper" data-min="0" data-max="999" data-step="1">
                <button type="button" class="num-stepper-btn" onclick={() => stepperChange('progressVal', -1, 0, 999, 1)}>−</button>
                <span class="num-stepper-val" id="svelte-progressDisplay">{progressVal}</span>
                <button type="button" class="num-stepper-btn" onclick={() => stepperChange('progressVal', 1, 0, 999, 1)}>+</button>
              </div>
            </div>
          </div>
          <div class="field-row">
            <div class="field-cell">
              <label class="field-label">{tr('common.startDate', '开始日期')}</label>
              <div class="date-segments" data-date="startedAt">
                <input type="text" class="date-seg date-seg--y" maxlength="4" placeholder="YYYY" inputmode="numeric" value={startSeg.y} oninput={(e) => segAutoTab(e, startSeg, 'y')}>
                <span class="date-sep">/</span>
                <input type="text" class="date-seg date-seg--m" maxlength="2" placeholder="MM" inputmode="numeric" value={startSeg.m} oninput={(e) => segAutoTab(e, startSeg, 'm')}>
                <span class="date-sep">/</span>
                <input type="text" class="date-seg date-seg--d" maxlength="2" placeholder="DD" inputmode="numeric" value={startSeg.d} oninput={(e) => segAutoTab(e, startSeg, 'd')}>
              </div>
            </div>
            <div class="field-cell">
              <label class="field-label">{tr('common.endDate', '结束日期')}</label>
              <div class="date-segments" data-date="completedAt">
                <input type="text" class="date-seg date-seg--y" maxlength="4" placeholder="YYYY" inputmode="numeric" value={endSeg.y} oninput={(e) => segAutoTab(e, endSeg, 'y')}>
                <span class="date-sep">/</span>
                <input type="text" class="date-seg date-seg--m" maxlength="2" placeholder="MM" inputmode="numeric" value={endSeg.m} oninput={(e) => segAutoTab(e, endSeg, 'm')}>
                <span class="date-sep">/</span>
                <input type="text" class="date-seg date-seg--d" maxlength="2" placeholder="DD" inputmode="numeric" value={endSeg.d} oninput={(e) => segAutoTab(e, endSeg, 'd')}>
              </div>
            </div>
            <div class="field-cell">
              <label class="field-label">{tr('common.notes', '笔记')}</label>
              <input type="text" id="svelte-notesInput" class="notes-input" placeholder={tr('mylist.notesPlaceholder', '简短记录...')} maxlength="200" bind:value={notes}>
            </div>
          </div>
        </div>
        <div class="status-modal-footer">
          <button class="btn btn-primary" onclick={saveStatusModal}>{tr('common.save', '保存')}</button>
        </div>
      </div>
    </div>
  </div>
{/if}