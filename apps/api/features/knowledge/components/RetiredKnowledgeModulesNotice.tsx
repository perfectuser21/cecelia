import { Link } from 'react-router-dom';

export default function RetiredKnowledgeModulesNotice() {
  return (
    <main style={{ padding: '32px', maxWidth: '720px' }}>
      <h1>旧知识生成进度已退役</h1>
      <p>知识内容在 Notion 维护，任务进度以 Brain 任务账本为准。</p>
      <p>
        <a
          href="https://app.notion.com/p/770c40c2ba6383ea86d001eba832c218"
          target="_blank"
          rel="noopener noreferrer"
        >
          前往 Notion 知识库
        </a>
      </p>
      <Link to="/knowledge">返回知识首页</Link>
    </main>
  );
}
