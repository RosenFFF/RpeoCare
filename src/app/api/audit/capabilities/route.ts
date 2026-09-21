import { poolOnline as workerOnline } from '@/server/audit/queue';
import { jsonResponse, session } from '@/server/audit/http';
import { publicSelection, selectedConnection } from '@/server/models/run-config';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  let model;
  let agentConfigured = false;
  let modelError;
  try {
    const connection = selectedConnection(session(request));
    if (connection) {
      model = publicSelection(connection);
      let local = false;
      try { local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(connection.baseUrl).hostname); } catch { /* Environment catalog resolves later. */ }
      agentConfigured = Boolean(connection.apiKey) || local;
      if (!agentConfigured) modelError = '默认连接尚未设置 API Key，请到模型设置中补全。';
    }
  } catch { modelError = '模型配置暂时无法读取，请检查设置或服务端主密钥。'; }
  return jsonResponse({
    workerOnline: workerOnline(),
    agentConfigured, model, modelError,
    githubAuthenticated: Boolean(process.env.REPOCARE_GITHUB_TOKEN),
  });
}
