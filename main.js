'use strict';

/* ===== 設定 ===== */
const MODEL = 'gemini-2.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com';
// 総リクエストサイズの上限(約20MB)を考慮し、これ以下はインライン送信、超えたら File API を使う
const INLINE_LIMIT = 14 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 65536;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const els = {
  apiKey: $('api-key'),
  saveKeyBtn: $('save-key-btn'),
  keyStatus: $('key-status'),
  lectureName: $('lecture-name'),
  audioFile: $('audio-file'),
  generateBtn: $('generate-btn'),
  loading: $('loading'),
  loadingText: $('loading-text'),
  outputArea: $('output-area'),
  warning: $('output-warning'),
  summary: $('summary-content'),
  points: $('points-content'),
  transcript: $('transcript-content'),
};

/* ===== APIキー ===== */
const savedKey = localStorage.getItem('gemini_api_key');
if (savedKey) els.apiKey.value = savedKey;

function setKeyStatus(msg, kind) {
  els.keyStatus.textContent = msg || '';
  els.keyStatus.classList.toggle('error', kind === 'error');
  els.keyStatus.classList.toggle('hidden', !msg);
}

els.saveKeyBtn.addEventListener('click', async () => {
  const key = els.apiKey.value.trim();
  if (!key) {
    setKeyStatus('APIキーを入力してください。', 'error');
    return;
  }
  els.saveKeyBtn.disabled = true;
  const looksUnusual = !/^AIza[0-9A-Za-z_-]{10,}$/.test(key);
  setKeyStatus(
    looksUnusual
      ? '見慣れない形式ですが、通信を確認しています...'
      : '通信を確認しています...',
    'info'
  );
  try {
    const res = await fetch(
      `${API_BASE}/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      }
    );
    if (!res.ok) throw new Error(await describeError(res));
    localStorage.setItem('gemini_api_key', key);
    setKeyStatus('✓ 通信成功。キーをこのブラウザに保存しました。', 'success');
  } catch (err) {
    setKeyStatus(`通信に失敗しました。${err.message}`, 'error');
  } finally {
    els.saveKeyBtn.disabled = false;
  }
});

/* ===== ノート生成 ===== */
els.generateBtn.addEventListener('click', async () => {
  const key = els.apiKey.value.trim();
  const file = els.audioFile.files[0];
  const lectureName = els.lectureName.value.trim();

  if (!key) {
    setKeyStatus('先にAPIキーを入力して保存してください。', 'error');
    return;
  }
  if (!file) {
    alert('音声ファイルを選択してください。');
    return;
  }

  els.generateBtn.disabled = true;
  els.outputArea.classList.add('hidden');
  els.warning.classList.add('hidden');
  els.loading.classList.remove('hidden');
  setLoading('音声を準備しています...');

  try {
    const audioPart =
      file.size > INLINE_LIMIT
        ? { fileData: await uploadViaFileApi(file, key) }
        : { inlineData: { mimeType: mimeOf(file), data: await fileToBase64(file) } };

    setLoading('AIが音声を解析しています（数分かかることがあります）...');
    const result = await generateNote(key, lectureName, audioPart);
    render(result);
  } catch (err) {
    console.error(err);
    alert(`エラーが発生しました:\n${err.message}`);
  } finally {
    els.loading.classList.add('hidden');
    els.generateBtn.disabled = false;
  }
});

function setLoading(msg) {
  els.loadingText.textContent = msg;
}

function mimeOf(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const map = {
    mp3: 'audio/mp3',
    wav: 'audio/wav',
    aiff: 'audio/aiff',
    aif: 'audio/aiff',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    opus: 'audio/opus',
    webm: 'audio/webm',
  };
  if (map[ext]) return map[ext];
  const t = (file.type || '').toLowerCase();
  if (t === 'audio/mpeg') return 'audio/mp3';
  return t || 'audio/mp3';
}

async function generateNote(key, lectureName, audioPart) {
  const titleLine = lectureName ? `講義名: 「${lectureName}」\n\n` : '';
  const prompt = `${titleLine}添付した講義音声を解析し、日本語で以下のフォーマット通りに出力してください。
見出しは必ず「###要約###」「###要点###」「###文字起こし###」という文字列をそれぞれ独立した行に書いてください。見出しにマークダウン記号（#, *, - など）は使わないでください。

###要約###
・（講義全体の内容を3行の箇条書きで。各行の先頭は「・」）

###要点###
1. （重要ポイントを3〜5個。各行の先頭を「1.」「2.」…の連番にする）

###文字起こし###
（音声の書き起こし全文。聞き取りにくい部分は前後の文脈から自然に補完する）`;

  const res = await fetchWithRetry(
    `${API_BASE}/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, audioPart] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: MAX_OUTPUT_TOKENS },
      }),
    },
    {
      onRetry: (n, total) =>
        setLoading(`Geminiが混雑しています。再試行しています... (${n}/${total})`),
    }
  );
  if (!res.ok) throw new Error(await describeError(res));

  const data = await res.json();
  if (data.promptFeedback?.blockReason) {
    throw new Error(`コンテンツがブロックされました（${data.promptFeedback.blockReason}）。`);
  }
  const cand = data.candidates?.[0];
  if (!cand) {
    throw new Error('AIから有効な応答が返りませんでした。音声が長すぎる可能性があります。');
  }
  const text = (cand.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('AIの応答が空でした。もう一度お試しください。');

  return { text, truncated: cand.finishReason === 'MAX_TOKENS' };
}

/* ===== File API（大きい音声ファイル用） ===== */
async function uploadViaFileApi(file, key) {
  setLoading('音声ファイルをアップロードしています...');
  const startRes = await fetch(
    `${API_BASE}/upload/v1beta/files?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(file.size),
        'X-Goog-Upload-Header-Content-Type': mimeOf(file),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: file.name } }),
    }
  );
  if (!startRes.ok) throw new Error(await describeError(startRes));

  const uploadUrl = startRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new Error(
      'アップロードURLを取得できませんでした（ブラウザのCORS制限の可能性があります）。ファイルを14MB以下に分割してお試しください。'
    );
  }

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Type': mimeOf(file),
    },
    body: file,
  });
  if (!uploadRes.ok) throw new Error(await describeError(uploadRes));

  let info = (await uploadRes.json()).file;

  // state が ACTIVE になるまで待機
  for (let i = 0; info.state === 'PROCESSING' && i < 100; i++) {
    setLoading(`音声を処理しています... (${i * 3}秒経過)`);
    await sleep(3000);
    const poll = await fetch(
      `${API_BASE}/v1beta/${info.name}?key=${encodeURIComponent(key)}`
    );
    if (!poll.ok) throw new Error(await describeError(poll));
    info = await poll.json();
  }
  if (info.state !== 'ACTIVE') {
    throw new Error(`音声ファイルの処理に失敗しました（state: ${info.state}）。`);
  }
  return { mimeType: info.mimeType, fileUri: info.uri };
}

/* ===== 結果表示 ===== */
function render({ text, truncated }) {
  const pick = (name, others) => {
    const re = new RegExp(
      `###\\s*${name}\\s*###([\\s\\S]*?)(?=###\\s*(?:${others.join('|')})\\s*###|$)`
    );
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };

  els.summary.textContent = pick('要約', ['要点', '文字起こし']) || '（抽出に失敗しました）';
  els.points.textContent = pick('要点', ['要約', '文字起こし']) || '（抽出に失敗しました）';
  els.transcript.textContent = pick('文字起こし', ['要約', '要点']) || text;

  els.warning.classList.toggle('hidden', !truncated);
  if (truncated) {
    els.warning.textContent =
      '⚠️ 出力が上限に達し、文字起こしが途中で切れている可能性があります。音声を短く分割して再度お試しください。';
  }

  els.outputArea.classList.remove('hidden');
  els.outputArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ===== コピー ===== */
document.querySelectorAll('.btn-copy').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const target = $(btn.dataset.target);
    if (!target || !target.textContent) return;
    try {
      await navigator.clipboard.writeText(target.textContent);
      const original = btn.textContent;
      btn.textContent = 'コピーしました ✓';
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
    } catch {
      alert('コピーに失敗しました。手動で選択してコピーしてください。');
    }
  });
});

/* ===== ユーティリティ ===== */
// 503(過負荷)/429(レート制限)は一時的なことが多いため、指数バックオフで自動リトライする
async function fetchWithRetry(url, options, { retries = 3, baseDelayMs = 3000, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, options);
    if (res.ok || attempt >= retries || (res.status !== 503 && res.status !== 429)) {
      return res;
    }
    onRetry?.(attempt + 1, retries);
    await sleep(baseDelayMs * 2 ** attempt);
  }
}

async function describeError(res) {
  let msg = '';
  try {
    const j = await res.json();
    msg = j.error?.message || j.error?.status || '';
  } catch {
    /* JSON でないレスポンス */
  }
  if (!msg) {
    if (res.status === 404) msg = 'モデルが見つかりません。';
    else if (res.status === 403) msg = 'APIキーが無効か、権限がありません。';
    else if (res.status === 429) msg = 'レート上限に達しました。しばらく待って再試行してください。';
    else if (res.status === 503) msg = 'Geminiが混雑しています。しばらく待って再試行してください。';
  }
  return `HTTP ${res.status}${msg ? `: ${msg}` : ''}`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
    reader.readAsDataURL(file);
  });
}
