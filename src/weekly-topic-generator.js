import axios from 'axios';
import fs from 'fs';
import path from 'path';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;

// 既存記事の学習データを読み込む
function loadLearningArticles() {
  const articlesPath = path.join(process.cwd(), 'data', 'learning-articles.md');
  return fs.readFileSync(articlesPath, 'utf-8');
}

// Claude API でトピック池を生成
async function generateTopicPool() {
  const learningArticles = loadLearningArticles();

  const systemPrompt = `あなたはGENTの記事執筆アシスタントです。
恋愛コーチング領域で、生徒さんが「なるほど！」と思える実践的なトピックを提案します。

【重要な指示】
- トーン：営業コンサル視点（ビジネス理論×恋愛）
- 既存の3つの文体パターン（運営者風・舞香風・百足風）を参考に
- 新ジャンル「性（キス・SEXなど）」は運営者風で提案
- 各トピックに簡潔な構成骨子も含める
- JSON形式で返す（LINEメッセージ整形用）

【学習教材】
${learningArticles}`;

  const userPrompt = `この週のGENT記事トピック池を作成してください。

【要件】
- トピック数：3-4本
- ジャンル：会話、身だしなみ、LINE、実話、性（キス・SEXなど）から選択
- 各トピックに：
  * タイトル
  * 簡潔な構成（見出し3-4個）
  * 推奨文体（運営者風/舞香風/百足風）
  * 短い説明

【出力形式】
JSON形式で、以下の構造で返してください：
{
  "week": "2024-XX-XX",
  "topics": [
    {
      "id": 1,
      "title": "タイトル",
      "genre": "性",
      "style": "運営者風",
      "outline": ["見出し1", "見出し2", "見出し3"],
      "description": "このトピックの狙い"
    }
  ]
}`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    // Claude の応答から「本文（text）」ブロックを探す
    // （thinkingブロックなど、text以外が先頭に来ることがあるため）
    const textBlock = response.data.content.find(block => block.type === 'text');

    if (!textBlock || !textBlock.text) {
      console.error('Full response:', JSON.stringify(response.data, null, 2));
      throw new Error('No text content found in Claude response');
    }

    const content = textBlock.text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('JSON not found in Claude response');
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('Claude API error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

// トピック池を LINE メッセージにフォーマット
function formatTopicsForLine(topicData) {
  const messages = [];

  // ヘッダーメッセージ
  messages.push({
    type: 'text',
    text: `📌 今週のトピック池\n\n今週のおすすめ記事トピック ${topicData.topics.length} 本です。どれで執筆しますか？`
  });

  // 各トピックをメッセージ化
  topicData.topics.forEach((topic, index) => {
    const outlineText = topic.outline.map((o, i) => `  ${i + 1}. ${o}`).join('\n');
    const message = `【${index + 1}】${topic.title}\n\n📂 ジャンル：${topic.genre}\n🎨 文体：${topic.style}\n\n📋 構成案：\n${outlineText}\n\n💡 ${topic.description}`;

    messages.push({
      type: 'text',
      text: message
    });
  });

  // 返信用フッター
  messages.push({
    type: 'text',
    text: `\n👉 「①で」「②で」など、番号で返信してください！`
  });

  return messages;
}

// LINE Messaging API でメッセージを送信
async function sendToLine(messages) {
  try {
    for (const msg of messages) {
      await axios.post(
        'https://api.line.biz/v2/bot/message/push',
        {
          to: LINE_USER_ID,
          messages: [
            {
              type: 'text',
              text: msg.text
            }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // LINE API のレート制限対策
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    console.log(`✅ Sent ${messages.length} messages to LINE`);
  } catch (error) {
    console.error('LINE API error:', error.message);
    throw error;
  }
}

// メイン処理
async function main() {
  try {
    console.log('🚀 Starting weekly topic generation...');

    // Step 1: トピック池を生成
    console.log('📝 Generating topics with Claude...');
    const topicData = await generateTopicPool();

    // Step 2: LINE メッセージにフォーマット
    console.log('📋 Formatting messages for LINE...');
    const lineMessages = formatTopicsForLine(topicData);

    // Step 3: LINE に送信
    console.log('📤 Sending to LINE...');
    await sendToLine(lineMessages);

    // Step 4: ログを保存（後で確認用）
    const logPath = path.join(process.cwd(), 'logs', `topic-pool-${new Date().toISOString().split('T')[0]}.json`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, JSON.stringify(topicData, null, 2));

    console.log('✅ Completed successfully!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
