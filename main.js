document.addEventListener('DOMContentLoaded', () => {
    // DOM要素の取得
    const apiKeyInput = document.getElementById('api-key');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const keyStatus = document.getElementById('key-status');
    const generateBtn = document.getElementById('generate-btn');
    const audioFileInput = document.getElementById('audio-file');
    const loadingDiv = document.getElementById('loading');
    const outputArea = document.getElementById('output-area');
    const copyBtns = document.querySelectorAll('.btn-copy');

    // 1. ページ読み込み時に保存されたAPIキーを復元
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
        apiKeyInput.value = savedKey;
        keyStatus.textContent = 'APIキーは保存されています。';
    }

    // 2. APIキーの保存処理
    saveKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            localStorage.setItem('gemini_api_key', key);
            keyStatus.textContent = 'APIキーを保存しました！';
            keyStatus.style.color = 'green';

testGeminiAPI(key);

        } else {
            localStorage.removeItem('gemini_api_key');
            keyStatus.textContent = 'APIキーを削除しました。';
            keyStatus.style.color = 'red';
        }
    });

    // 3. コピーボタンの処理（クリップボードAPI）
    copyBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const targetId = e.target.getAttribute('data-target');
            const content = document.getElementById(targetId).textContent;
            
            if (!content) return;

            try {
                await navigator.clipboard.writeText(content);
                const originalText = e.target.textContent;
                e.target.textContent = 'コピー完了！';
                setTimeout(() => { e.target.textContent = originalText; }, 2000);
            } catch (err) {
                alert('コピーに失敗しました。');
            }
        });
    });

// 4. 生成ボタンの処理（本番用）
    generateBtn.addEventListener('click', async () => {
        const key = apiKeyInput.value.trim();
        const file = audioFileInput.files[0];
        const lectureName = document.getElementById('lecture-name').value.trim();

        // エラーチェック
        if (!key) {
            alert('設定エリアにGemini APIキーを入力して保存してください。');
            return;
        }
        if (!file) {
            alert('音声ファイルを選択してください。');
            return;
        }

        // 画面の表示切り替え（ローディング開始）
        generateBtn.disabled = true;
        loadingDiv.classList.remove('hidden');
        outputArea.classList.add('hidden');

        try {
            // 音声ファイルをAIに送れるテキスト形式（Base64）に変換する
            const base64Data = await fileToBase64(file);
            
            // Gemini APIの通信先（実験で成功した最新のURL）
            const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${key}`;
            
            // AIへの指示書き（プロンプト）
            const lectureTitlePrompt = lectureName ? `講義名: 「${lectureName}」\n` : "";
            const promptText = `${lectureTitlePrompt}上記の講義音声を解析し、以下のフォーマットで日本語で出力してください。

###要約###
（ここに講義全体の内容を3行の箇条書きで要約してください。各行の先頭は「・」にしてください。）

###要点###
（ここに講義の重要ポイントを3〜5個の箇条書きでまとめてください。各行の先頭は「1. 2. 3.」のように数字にしてください。）

###文字起こし###
（ここに音声の書き起こし全文を出力してください。聞き取りにくい部分は前後の文脈から自然に補完してください。）`;

            // Googleのサーバーへ送信するデータの作成
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: promptText },
                            {
                                inlineData: {
                                    mimeType: file.type,
                                    data: base64Data
                                }
                            }
                        ]
                    }]
                })
            });

            if (!response.ok) {
                throw new Error(`HTTPエラー: ステータスコード ${response.status}`);
            }

            const data = await response.json();
            const aiResponseText = data.candidates[0].content.parts[0].text;

            // AIからの返答を分解して画面に表示する
            parseAndDisplayResult(aiResponseText);

            // ローディングを終了して結果を表示
            outputArea.classList.remove('hidden');

        } catch (error) {
            console.error("❌ エラー発生:", error);
            alert(`エラーが発生しました: ${error.message}\nファイルサイズが大きすぎるか、非対応の形式の可能性があります。`);
        } finally {
            // 成功・失敗に関わらずボタンを元に戻す
            loadingDiv.classList.add('hidden');
            generateBtn.disabled = false;
        }
    });

    // --- 音声ファイルをBase64形式に変換する補助関数 ---
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                // 「data:audio/mp3;base64,XXXX...」の「XXXX...」の部分だけを抜き出す
                const base64String = reader.result.split(',')[1];
                resolve(base64String);
            };
            reader.onerror = error => reject(error);
        });
    }

    // --- AIの返答から各エリアに文字を振り分ける関数 ---
    function parseAndDisplayResult(text) {
        const summaryContent = document.getElementById('summary-content');
        const pointsContent = document.getElementById('points-content');
        const transcriptContent = document.getElementById('transcript-content');

        // ### で区切られたエリアを切り出す処理
        const summaryMatch = text.match(/###要約###([\s\S]*?)(?=###要点###|###文字起こし###|$)/);
        const pointsMatch = text.match(/###要点###([\s\S]*?)(?=###要約###|###文字起こし###|$)/);
        const transcriptMatch = text.match(/###文字起こし###([\s\S]*?)(?=###要約###|###要点###|$)/);

        summaryContent.textContent = summaryMatch ? summaryMatch[1].trim() : "要約の抽出に失敗しました。";
        pointsContent.textContent = pointsMatch ? pointsMatch[1].trim() : "要点の抽出に失敗しました。";
        transcriptContent.textContent = transcriptMatch ? transcriptMatch[1].trim() : text; // 失敗したら全文表示
    }

});

// --- 【確定版】Gemini API通信テスト関数 ---
async function testGeminiAPI(apiKey) {
    console.log("最新のURL（gemini-2.5-flash）でGemini APIへ通信中...");
    
    // 実験で成功した最新のURL
    const url = "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=" + apiKey;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: "こんにちは！" }] }]
            })
        });

        if (!response.ok) {
            throw new Error(`HTTPエラー: ステータスコード ${response.status}`);
        }

        const data = await response.json();
        const replyText = data.candidates[0].content.parts[0].text;
        
        console.log("✅ 【Geminiからの返答】:", replyText);
        alert("通信成功！ついにアプリ側からも繋がりました！");
    } catch (error) {
        console.error("❌ 【テスト失敗】:", error);
        alert(`通信に失敗しました: ${error.message}`);
    }
}