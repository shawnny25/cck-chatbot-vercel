// Vercel Serverless Function: /api/export-logs
// (Netlify -> Vercel 이전, 2026-09-04)
// 챗봇에 들어온 질문 + 챗봇이 실제로 준 답변을 모아서 보여주는 관리자 전용 페이지.
// 아무나 볼 수 없도록 비밀 키(LOG_EXPORT_KEY)를 주소 끝의 ?key=... 로 확인한다.
// 사용 전 Vercel 프로젝트 Settings > Environment Variables 에
// LOG_EXPORT_KEY 라는 이름으로 본인이 정한 비밀번호(영문+숫자 조합 추천)를 등록해야 한다.
// (chat.js의 GEMINI_API_KEY 등록했던 것과 같은 화면, 같은 방법)

const { list, get } = require('@vercel/blob');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeCsv(s) {
  return `"${String(s).replace(/"/g, '""')}"`;
}

module.exports = async function handler(req, res) {
  const params = req.query || {};
  const requiredKey = process.env.LOG_EXPORT_KEY;

  if (!requiredKey) {
    res.status(500);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(
      '서버에 LOG_EXPORT_KEY 환경변수가 설정되지 않았습니다. Vercel 프로젝트 설정(Settings > Environment Variables)에서 LOG_EXPORT_KEY 라는 이름으로 비밀번호를 등록한 뒤 다시 시도해 주세요.'
    );
    return;
  }

  if (!params.key || params.key !== requiredKey) {
    res.status(401);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('접근 권한이 없습니다. 주소 끝에 ?key=설정한비밀번호 를 붙여서 다시 시도해 주세요.');
    return;
  }

  let rows = [];
  try {
    // ponytail: list()는 최대 1000개까지만 한 번에 가져옴 — 로그가 그 이상 쌓이면 페이지네이션(cursor) 추가 필요.
    // 스토어가 Private라 blob.url을 그냥 fetch()하면 접근 불가 — get(pathname, {access:'private'})로 읽어야 함.
    const { blobs } = await list({ prefix: 'chat-logs/' });
    const fetched = await Promise.all(
      blobs.map(async (b) => {
        try {
          const result = await get(b.pathname, { access: 'private' });
          if (!result || result.statusCode !== 200) return null;
          const text = await new Response(result.stream).text();
          return JSON.parse(text);
        } catch (e) {
          return null;
        }
      })
    );
    rows = fetched.filter((d) => d && d.message);
    rows.sort((a, b) => new Date(b.time) - new Date(a.time));
  } catch (err) {
    res.status(500);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('로그를 불러오는 중 오류가 발생했습니다: ' + (err && err.message));
    return;
  }

  const errorCount = rows.filter((r) => r.error).length;
  const format = params.format === 'csv' ? 'csv' : 'html';

  if (format === 'csv') {
    const csv = [
      '시간,질문,챗봇 답변,오류여부',
      ...rows.map(
        (r) =>
          `${escapeCsv(new Date(r.time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }))},${escapeCsv(r.message)},${escapeCsv(r.answer || '(답변 기록 없음)')},${
            r.error ? '오류' : '정상'
          }`
      ),
    ].join('\n');
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="chatbot_questions.csv"');
    res.end('﻿' + csv); // 엑셀에서 한글 깨지지 않도록 BOM 추가
    return;
  }

  const tableRows = rows
    .map((r) => {
      const answerText = r.answer ? escapeHtml(r.answer) : '<span class="muted">(답변 기록 없음 — connectLambda 수정 전 로그)</span>';
      const statusBadge = r.error
        ? '<span class="badge badge-error">오류</span>'
        : '<span class="badge badge-ok">정상</span>';
      return `<tr class="${r.error ? 'row-error' : ''}">
        <td>${escapeHtml(new Date(r.time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }))}</td>
        <td>${statusBadge}</td>
        <td>${escapeHtml(r.message)}</td>
        <td>${answerText}</td>
      </tr>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>챗봇 질문·답변 로그</title>
<style>
  body{font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;padding:24px;background:#f4f5f7;color:#1f2328;}
  h1{font-size:19px;margin:0 0 4px;}
  .meta{color:#6b7280;font-size:13px;margin-bottom:16px;}
  .btn{display:inline-block;margin-bottom:16px;padding:8px 16px;background:#e2231a;color:#fff;
       text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;}
  .btn:hover{background:#b81a13;}
  table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.05);table-layout:fixed;}
  th,td{border:1px solid #e5e7eb;padding:9px 12px;font-size:13.5px;text-align:left;vertical-align:top;word-break:break-word;}
  th{background:#f7941e;color:#fff;position:sticky;top:0;}
  td:first-child,th:first-child{white-space:nowrap;color:#6b7280;width:150px;}
  th:nth-child(2),td:nth-child(2){width:70px;}
  tr:nth-child(even){background:#fafafa;}
  tr.row-error{background:#fff4f4;}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:700;}
  .badge-ok{background:#e6f4ea;color:#1e7e34;}
  .badge-error{background:#fde8e8;color:#b81a13;}
  .muted{color:#9ca3af;font-style:italic;}
</style>
</head>
<body>
  <h1>챗봇 질문·답변 로그 (총 ${rows.length}건, 오류 ${errorCount}건)</h1>
  <div class="meta">최근 순 정렬. 개인정보 없이 질문·답변 내용과 시간만 저장됩니다. 오류로 표시된 항목은 챗봇이 정상 답변을 주지 못한 경우입니다.</div>
  <a class="btn" href="?key=${encodeURIComponent(params.key)}&format=csv">⬇ CSV로 다운로드 (엑셀에서 열기)</a>
  <table>
    <thead><tr><th>시간</th><th>상태</th><th>질문 내용</th><th>챗봇 답변</th></tr></thead>
    <tbody>${tableRows || '<tr><td colspan="4">아직 기록된 질문이 없습니다.</td></tr>'}</tbody>
  </table>
</body>
</html>`;

  res.status(200);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
};
