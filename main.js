document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('api-key');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const saveStatus = document.getElementById('save-status');
    
    const lectureNameInput = document.getElementById('lecture-name');
    const audioFileInput = document.getElementById('audio-file');
    const generateBtn = document.getElementById('generate-btn');
    
    const loadingDiv = document.getElementById('loading');
    const outputArea = document.getElementById('output-area');

    // 1. ページ読み込み時に保存済みのAPIキーがあればセット
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
        apiKeyInput.value = savedKey;
    }

    // 2. APIキーの保存＋疎通テスト
    saveKeyBtn.addEventListener('click', async () => {
        const key = apiKeyInput.value.trim();
        if (!key) {
            alert('APIキーを入力してください。');
            return;
        }

        try {
            console.log("Gemini APIへ通信テスト中...");
            // 安定版エンドポイント指定
            const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
            
            const response = await fetch(testUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: "こんにちは。応答してください。" }] }]
                })
            });

            if (response.ok) {
                localStorage.setItem('gemini_api_key', key);
                saveStatus.classList.remove('hidden');
                alert('通信成功！キーを保存しました。');
                setTimeout(() => saveStatus.classList.add('hidden'), 3000);
            } else {
                throw new Error(`HTTPステータス: ${response.status}`);
            }
        } catch (error) {
            console.error("❌ 疎通テスト失敗:", error);
            alert(`通信に失敗しました。キーを確認してください。\nエラー内容: ${error.message}`);
        }
    });

    // 3. 生成ボタンの処理（本番用）
    generateBtn.addEventListener('click', async () => {
        const key = apiKeyInput.value.trim();
        const file = audioFileInput.files[0];
        const lectureName = lectureNameInput.value.trim();

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
            // 音声ファイルをBase64形式に変換
            const base64Data = await fileToBase64(file);
            
            // 安定動作モデルへURL固定
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
            
            // AIへの構造化プロンプト
            const lectureTitlePrompt = lectureName ? `講義名: 「${lectureName}」\n` : "";
            const promptText = `${lectureTitlePrompt}上記の講義音声を解析し、以下のフォーマットで日本語で出力してください。

###要約###
（ここに講義全体の内容を3行の箇条書きで要約してください。各行の先頭は「・」にしてください。）

###要点###
（ここに講義の重要ポイントを3〜5個の箇条書きでまとめてください。各行の先頭は「1. 2. 3.」のように数字にしてください。）

###文字起こし###
（ここに音声の書き起こし全文を出力してください。聞き取りにくい部分は前後の文脈から自然に補完してください。）`;

            // リクエスト送信
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: promptText },
                            {
                                inlineData: {
                                    mimeType: file.type || "audio/mp3",
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

            // AIからの結果をパースして画面表示
            parseAndDisplayResult(aiResponseText);
            outputArea.classList.remove('hidden');

        } catch (error) {
            console.error("❌ エラー発生:", error);
            alert(`エラーが発生しました: ${error.message}\nAPIキーが有効か、またはファイル形式をご確認ください。`);
        } finally {
            loadingDiv.classList.add('hidden');
            generateBtn.disabled = false;
        }
    });

    // 音声ファイルをBase64化する関数
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                const base64String = reader.result.split(',')[1];
                resolve(base64String);
            };
            reader.onerror = error => reject(error);
        });
    }

    // AIの返答テキストを分割して画面挿入する関数
    function parseAndDisplayResult(text) {
        const summaryContent = document.getElementById('summary-content');
        const pointsContent = document.getElementById('points-content');
        const transcriptContent = document.getElementById('transcript-content');

        const summaryMatch = text.match(/###要約###([\s\S]*?)(?=###要点###|###文字起こし###|$)/);
        const pointsMatch = text.match(/###要点###([\s\S]*?)(?=###要約###|###文字起こし###|$)/);
        const transcriptMatch = text.match(/###文字起こし###([\s\S]*?)(?=###要約###|###要点###|$)/);

        summaryContent.textContent = summaryMatch ? summaryMatch[1].trim() : "要約の抽出に失敗しました。";
        pointsContent.textContent = pointsMatch ? pointsMatch[1].trim() : "要点の抽出に失敗しました。";
        transcriptContent.textContent = transcriptMatch ? transcriptMatch[1].trim() : text;
    }
});
