/**
 * Speech-to-Text API Routes
 * 语音转文字 API 路由
 */

import express, { Router, Request, Response } from 'express';
import { SpeechToTextService, TranscribeRequest, SpeechToTextSettings, SpeechProvider } from '../services/speechToText';

const router: Router = express.Router();

/**
 * GET /api/speech-to-text/settings
 * 获取语音转文字服务设置
 */
router.get('/settings', async (req: Request, res: Response) => {
  try {
    const service = await SpeechToTextService.getInstance();
    const settings = service.getSettings();

    // 脱敏敏感信息
    const sanitizedSettings = sanitizeSettings(settings);

    res.json(sanitizedSettings);
  } catch (error) {
    console.error('Failed to get speech-to-text settings:', error);
    res.status(500).json({
      error: 'Failed to get settings',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/speech-to-text/settings
 * 更新语音转文字服务设置
 */
router.put('/settings', async (req: Request, res: Response) => {
  try {
    const service = await SpeechToTextService.getInstance();
    const newSettings: Partial<SpeechToTextSettings> = req.body;

    await service.updateSettings(newSettings);

    // 重新获取设置并返回
    const updatedService = await SpeechToTextService.reloadInstance();
    const settings = updatedService.getSettings();
    const sanitizedSettings = sanitizeSettings(settings);

    res.json({
      success: true,
      settings: sanitizedSettings,
    });
  } catch (error) {
    console.error('Failed to update speech-to-text settings:', error);
    res.status(500).json({
      error: 'Failed to update settings',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/speech-to-text/status
 * 获取服务状态
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const service = await SpeechToTextService.getInstance();

    res.json({
      enabled: service.isEnabled(),
      availableProviders: service.getAvailableProviders(),
      defaultProvider: service.getDefaultProvider(),
    });
  } catch (error) {
    console.error('Failed to get speech-to-text status:', error);
    res.status(500).json({
      error: 'Failed to get status',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/speech-to-text/transcribe
 * 执行语音转文字
 */
router.post('/transcribe', async (req: Request, res: Response) => {
  try {
    const service = await SpeechToTextService.getInstance();

    // 检查服务是否启用
    if (!service.isEnabled()) {
      return res.status(400).json({
        error: 'Service not enabled',
        message: 'Speech-to-text service is not enabled. Please enable it in settings.',
      });
    }

    // 验证请求体
    const { audioData, audioFormat, language, provider } = req.body as TranscribeRequest;

    if (!audioData) {
      return res.status(400).json({
        error: 'Missing audioData',
        message: 'Audio data is required',
      });
    }

    if (!audioFormat) {
      return res.status(400).json({
        error: 'Missing audioFormat',
        message: 'Audio format is required (e.g., "webm", "wav", "mp3")',
      });
    }

    // 执行转写
    const result = await service.transcribe({
      audioData,
      audioFormat,
      language,
      provider: provider as SpeechProvider,
    });

    res.json(result);
  } catch (error) {
    console.error('Failed to transcribe audio:', error);
    res.status(500).json({
      error: 'Transcription failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/speech-to-text/test
 * 测试指定供应商的配置
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { provider, audioData, audioFormat } = req.body;

    if (!provider) {
      return res.status(400).json({
        error: 'Missing provider',
        message: 'Provider name is required',
      });
    }

    const service = await SpeechToTextService.getInstance();
    const availableProviders = service.getAvailableProviders();

    if (!availableProviders.includes(provider)) {
      return res.status(400).json({
        error: 'Provider not available',
        message: `Provider '${provider}' is not configured or enabled`,
        availableProviders,
      });
    }

    // 如果提供了音频数据，执行测试转写
    if (audioData && audioFormat) {
      const result = await service.transcribe({
        audioData,
        audioFormat,
        provider,
      });

      return res.json({
        success: true,
        provider,
        result,
      });
    }

    // 否则只返回配置验证结果
    res.json({
      success: true,
      provider,
      message: `Provider '${provider}' is configured and ready`,
    });
  } catch (error) {
    console.error('Failed to test provider:', error);
    res.status(500).json({
      error: 'Test failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * 脱敏设置中的敏感信息
 */
function sanitizeSettings(settings: SpeechToTextSettings): SpeechToTextSettings {
  const sanitize = (value: string): string => {
    if (!value || value.length <= 8) {
      return value ? '****' : '';
    }
    return value.substring(0, 4) + '****' + value.substring(value.length - 4);
  };

  return {
    ...settings,
    providers: {
      openai: {
        ...settings.providers.openai,
        apiKey: sanitize(settings.providers.openai.apiKey),
      },
      groq: {
        ...settings.providers.groq,
        apiKey: sanitize(settings.providers.groq.apiKey),
      },
      aliyun: {
        ...settings.providers.aliyun,
        accessKeyId: sanitize(settings.providers.aliyun.accessKeyId),
        accessKeySecret: sanitize(settings.providers.aliyun.accessKeySecret),
        appKey: sanitize(settings.providers.aliyun.appKey),
      },
      tencent: {
        ...settings.providers.tencent,
        secretId: sanitize(settings.providers.tencent.secretId),
        secretKey: sanitize(settings.providers.tencent.secretKey),
        appId: sanitize(settings.providers.tencent.appId),
      },
      google: {
        ...settings.providers.google,
        apiKey: sanitize(settings.providers.google.apiKey),
      },
    },
  };
}

export default router;
