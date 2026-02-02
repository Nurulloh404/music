const BASE = 'https://api.deezer.com';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }

  const rawPath = event.path || '';
  const path = rawPath
    .replace(/^\/\.netlify\/functions\/deezer/, '')
    .replace(/^\/api/, '') || '/';
  const params = new URLSearchParams(event.queryStringParameters || {});
  const url = `${BASE}${path}${params.toString() ? `?${params}` : ''}`;

  const res = await fetch(url);
  const body = await res.text();

  return {
    statusCode: res.status,
    headers: {
      ...cors,
      'content-type': res.headers.get('content-type') || 'application/json',
    },
    body,
  };
};
