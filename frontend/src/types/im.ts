export interface IMChannel {
  chat_id: string;
  chat_name?: string;
}

export interface IMBinding {
  id: string;
  platform: 'wecom' | 'qqbot' | 'weixin';
  name: string;
  project_path: string;
  project_name: string;
  bot_key: string;
  a2a_endpoint: string;
  platform_config?: Record<string, unknown>;
  channels?: IMChannel[];
  created_at: string;
  updated_at: string;
}

export const PLATFORM_LABELS: Record<IMBinding['platform'], string> = {
  wecom: '企业微信',
  qqbot: 'QQ Bot',
  weixin: '微信',
};

export const PLATFORM_BIND_ROUTES: Record<IMBinding['platform'], string> = {
  wecom: '/wecom-bind',
  qqbot: '/qqbot-bind',
  weixin: '/wechat-bind',
};
