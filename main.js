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
  includeTranscript: $('include-transcript'),
  generateBtn: $('generate-btn'),
  loading: $('loading'),
  loadingText: $('loading-text'),
  outputArea: $('output-area'),
  outputLectureName: $('output-lecture-name'),
  warning: $('output-warning'),
  exportFormat: $('export-format'),
  exportBtn: $('export-btn'),
  summary: $('summary-content'),
  points: $('points-content'),
  transcript: $('transcript-content'),
  transcriptBox: $('transcript-box'),
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
    alert('音声・動画ファイルを選択してください。');
    return;
  }

  els.generateBtn.disabled = true;
  els.outputArea.classList.add('hidden');
  els.warning.classList.add('hidden');
  els.loading.classList.remove('hidden');
  setLoading('ファイルを準備しています...');

  try {
    const audioPart =
      file.size > INLINE_LIMIT
        ? { fileData: await uploadViaFileApi(file, key) }
        : { inlineData: { mimeType: mimeOf(file), data: await fileToBase64(file) } };

    const includeTranscript = els.includeTranscript.checked;
    setLoading('AIが解析しています（数分かかることがあります）...');
    const result = await generateNote(key, lectureName, audioPart, includeTranscript);
    render(result, includeTranscript);
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

// Gemini APIが受け付けるmime表記に正規化する。ブラウザ報告のfile.typeは環境で
// 表記揺れがある（例: .mov→video/quicktime, .m4a→audio/x-m4a）ため、
// 拡張子から公式ドキュメント記載の文字列に正規化するのを基本とする。
function mimeOf(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const t = (file.type || '').toLowerCase();

  // .mp4 / .webm は音声(録音アプリの出力等)・動画どちらもあり得るため、
  // ブラウザ報告のtypeで判別する
  if (ext === 'mp4') return t.startsWith('audio/') ? 'audio/mp4' : 'video/mp4';
  if (ext === 'webm') return t.startsWith('audio/') ? 'audio/webm' : 'video/webm';

  const map = {
    mp3: 'audio/mp3',
    wav: 'audio/wav',
    aiff: 'audio/aiff',
    aif: 'audio/aiff',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4', // 非公式だが実用上動作する
    mpeg: 'video/mpeg',
    mpg: 'video/mpeg',
    mov: 'video/mov',
    avi: 'video/avi',
    flv: 'video/x-flv',
    wmv: 'video/wmv',
    '3gp': 'video/3gpp',
  };
  if (map[ext]) return map[ext];

  // 未知の拡張子はブラウザ報告のtypeにフォールバック
  if (t.startsWith('audio/') || t.startsWith('video/')) {
    return t === 'audio/mpeg' ? 'audio/mp3' : t;
  }
  return 'audio/mp3';
}

async function generateNote(key, lectureName, audioPart, includeTranscript) {
  const titleLine = lectureName ? `講義名: 「${lectureName}」\n\n` : '';
  const headingList = includeTranscript
    ? '「###要約###」「###要点###」「###文字起こし###」'
    : '「###要約###」「###要点###」';

  let prompt = `${titleLine}添付した音声・動画で話されている内容を解析し、以下のフォーマット通りに出力してください。
見出しは必ず${headingList}という文字列をそれぞれ独立した行に書いてください。見出しにマークダウン記号（#, *, - など）は使わないでください。

###要約###
（日本語で。講義全体の内容を3行の箇条書きに。各行の先頭は「・」）

###要点###
（日本語で。重要ポイントを3〜5個の箇条書きに。各行の先頭を「1.」「2.」…の連番にする）`;

  prompt += includeTranscript
    ? `

###文字起こし###
（実際に話されている言語のまま、一字一句を書き起こす。日本語への翻訳・要約・言い換えは絶対に行わない。話されている言語が英語など日本語以外でも、その言語のまま出力する。聞き取りにくい部分のみ、前後の文脈から同じ言語で自然に補完する。話されている言語が途中で切り替わる場合は、その通りに切り替えて書き起こす）`
    : `

文字起こしは不要です。###文字起こし###の見出しや本文は出力しないでください。`;

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
    throw new Error('AIから有効な応答が返りませんでした。ファイルが長すぎる可能性があります。');
  }
  const text = (cand.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('AIの応答が空でした。もう一度お試しください。');

  return { text, truncated: cand.finishReason === 'MAX_TOKENS' };
}

/* ===== File API（大きいファイル用） ===== */
async function uploadViaFileApi(file, key) {
  setLoading('ファイルをアップロードしています...');
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
    setLoading(`処理しています... (${i * 3}秒経過)`);
    await sleep(3000);
    const poll = await fetch(
      `${API_BASE}/v1beta/${info.name}?key=${encodeURIComponent(key)}`
    );
    if (!poll.ok) throw new Error(await describeError(poll));
    info = await poll.json();
  }
  if (info.state !== 'ACTIVE') {
    throw new Error(`ファイルの処理に失敗しました（state: ${info.state}）。`);
  }
  return { mimeType: info.mimeType, fileUri: info.uri };
}

/* ===== 結果表示 ===== */
function render({ text, truncated }, includeTranscript) {
  const pick = (name, others) => {
    const re = new RegExp(
      `###\\s*${name}\\s*###([\\s\\S]*?)(?=###\\s*(?:${others.join('|')})\\s*###|$)`
    );
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };

  els.summary.textContent = pick('要約', ['要点', '文字起こし']) || '（抽出に失敗しました）';
  els.points.textContent = pick('要点', ['要約', '文字起こし']) || '（抽出に失敗しました）';

  els.transcriptBox.classList.toggle('hidden', !includeTranscript);
  els.transcript.textContent = includeTranscript
    ? pick('文字起こし', ['要約', '要点']) || text
    : '';

  const lectureName = els.lectureName.value.trim();
  els.outputLectureName.textContent = lectureName;
  els.outputLectureName.classList.toggle('hidden', !lectureName);

  els.warning.classList.toggle('hidden', !truncated);
  if (truncated) {
    els.warning.textContent =
      '⚠️ 出力が上限に達し、文字起こしが途中で切れている可能性があります。ファイルを短く分割するか、「文字起こし全文も生成する」のチェックを外して再度お試しください。';
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

/* ===== まとめてダウンロード ===== */
els.exportBtn.addEventListener('click', () => {
  const lectureName = els.lectureName.value.trim();
  const sections = [
    ['3行要約', els.summary.textContent],
    ['要点', els.points.textContent],
  ];
  if (!els.transcriptBox.classList.contains('hidden')) {
    sections.push(['文字起こし全文', els.transcript.textContent]);
  }
  const format = els.exportFormat.value;
  const isMd = format === 'md';
  const titleBlock = lectureName ? (isMd ? `# ${lectureName}\n\n` : `${lectureName}\n\n`) : '';
  const content =
    titleBlock +
    sections
      .map(([heading, body]) => (isMd ? `## ${heading}\n\n${body}` : `【${heading}】\n${body}`))
      .join(isMd ? '\n\n---\n\n' : '\n\n----------------\n\n');

  const blob = new Blob([content], {
    type: `${isMd ? 'text/markdown' : 'text/plain'};charset=utf-8`,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(els.lectureName.value.trim())}.${isMd ? 'md' : 'txt'}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

function sanitizeFilename(name) {
  const cleaned = (name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned.slice(0, 80) || 'lecture-note';
}

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
