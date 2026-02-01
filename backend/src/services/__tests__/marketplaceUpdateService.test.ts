/**
 * Unit tests for marketplaceUpdateService.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';

// Mock modules
vi.mock('fs');
vi.mock('../pluginPaths');
vi.mock('../pluginInstaller');

describe('MarketplaceUpdateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initializeMarketplaceUpdateService', () => {
    it('should initialize with default config', async () => {
      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.listMarketplaces).mockReturnValue([]);

      const { 
        initializeMarketplaceUpdateService,
        shutdownMarketplaceUpdateService,
        getMarketplaceUpdateServiceStatus 
      } = await import('../marketplaceUpdateService');
      
      initializeMarketplaceUpdateService();
      
      const status = getMarketplaceUpdateServiceStatus();
      expect(status.isInitialized).toBe(true);
      expect(status.config.enabled).toBe(true);
      expect(status.config.defaultCheckInterval).toBe(60);
      
      shutdownMarketplaceUpdateService();
    });

    it('should initialize with custom config', async () => {
      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.listMarketplaces).mockReturnValue([]);

      const { 
        initializeMarketplaceUpdateService,
        shutdownMarketplaceUpdateService,
        getMarketplaceUpdateServiceStatus 
      } = await import('../marketplaceUpdateService');
      
      initializeMarketplaceUpdateService({
        enabled: true,
        defaultCheckInterval: 120,
        autoApplyUpdates: true
      });
      
      const status = getMarketplaceUpdateServiceStatus();
      expect(status.config.defaultCheckInterval).toBe(120);
      expect(status.config.autoApplyUpdates).toBe(true);
      
      shutdownMarketplaceUpdateService();
    });
  });

  describe('scheduleUpdateCheck', () => {
    it('should schedule update checks for marketplaces with autoUpdate enabled', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        type: 'github',
        source: 'test/repo',
        autoUpdate: {
          enabled: true,
          checkInterval: 30
        }
      }));

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.listMarketplaces).mockReturnValue(['test-market']);
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { 
        initializeMarketplaceUpdateService,
        shutdownMarketplaceUpdateService,
        getMarketplaceUpdateServiceStatus 
      } = await import('../marketplaceUpdateService');
      
      initializeMarketplaceUpdateService();
      
      const status = getMarketplaceUpdateServiceStatus();
      expect(status.scheduledChecks.length).toBe(1);
      expect(status.scheduledChecks[0].marketplaceName).toBe('test-market');
      expect(status.scheduledChecks[0].intervalMinutes).toBe(30);
      
      shutdownMarketplaceUpdateService();
    });
  });

  describe('checkAllUpdatesNow', () => {
    it('should check all marketplaces for updates', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        name: 'test-market',
        version: '1.0.0'
      }));

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.listMarketplaces).mockReturnValue(['market1', 'market2']);
      vi.mocked(pluginPaths.getMarketplacePath).mockImplementation((name) => 
        `/test/.claude/plugins/marketplaces/${name}`
      );

      const { pluginInstaller } = await import('../pluginInstaller');
      vi.mocked(pluginInstaller.checkForUpdates).mockImplementation(async (name) => ({
        marketplaceId: name,
        marketplaceName: name,
        hasUpdate: name === 'market1',
        checkedAt: new Date().toISOString()
      }));

      const { 
        initializeMarketplaceUpdateService,
        shutdownMarketplaceUpdateService,
        checkAllUpdatesNow 
      } = await import('../marketplaceUpdateService');
      
      initializeMarketplaceUpdateService({ enabled: false });
      
      const result = await checkAllUpdatesNow();
      
      expect(result.results.length).toBe(2);
      expect(result.updatesAvailable).toBe(1);
      
      shutdownMarketplaceUpdateService();
    });
  });

  describe('checkUpdateNow', () => {
    it('should check a specific marketplace for updates', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.listMarketplaces).mockReturnValue([]);
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/path');

      const { pluginInstaller } = await import('../pluginInstaller');
      vi.mocked(pluginInstaller.checkForUpdates).mockResolvedValue({
        marketplaceId: 'test-market',
        marketplaceName: 'test-market',
        hasUpdate: true,
        localVersion: '1.0.0',
        remoteVersion: '1.1.0',
        checkedAt: new Date().toISOString()
      });

      const { 
        initializeMarketplaceUpdateService,
        shutdownMarketplaceUpdateService,
        checkUpdateNow 
      } = await import('../marketplaceUpdateService');
      
      initializeMarketplaceUpdateService({ enabled: false });
      
      const result = await checkUpdateNow('test-market');
      
      expect(result.hasUpdate).toBe(true);
      expect(result.localVersion).toBe('1.0.0');
      expect(result.remoteVersion).toBe('1.1.0');
      
      shutdownMarketplaceUpdateService();
    });
  });

  describe('updateMarketplaceAutoUpdateConfig', () => {
    it('should enable auto-update for a marketplace', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        type: 'github',
        source: 'test/repo'
      }));
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.listMarketplaces).mockReturnValue([]);
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { 
        initializeMarketplaceUpdateService,
        shutdownMarketplaceUpdateService,
        updateMarketplaceAutoUpdateConfig,
        getMarketplaceUpdateServiceStatus 
      } = await import('../marketplaceUpdateService');
      
      initializeMarketplaceUpdateService({ enabled: false });
      
      await updateMarketplaceAutoUpdateConfig('test-market', {
        enabled: true,
        checkInterval: 45
      });
      
      // Verify file was written with correct config
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.agentstudio-metadata.json'),
        expect.stringContaining('"enabled":true')
      );
      
      // Verify job was scheduled
      const status = getMarketplaceUpdateServiceStatus();
      expect(status.scheduledChecks.some(c => c.marketplaceName === 'test-market')).toBe(true);
      
      shutdownMarketplaceUpdateService();
    });

    it('should disable auto-update for a marketplace', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        type: 'github',
        source: 'test/repo',
        autoUpdate: {
          enabled: true,
          checkInterval: 30
        }
      }));
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.listMarketplaces).mockReturnValue(['test-market']);
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { 
        initializeMarketplaceUpdateService,
        shutdownMarketplaceUpdateService,
        updateMarketplaceAutoUpdateConfig,
        getMarketplaceUpdateServiceStatus 
      } = await import('../marketplaceUpdateService');
      
      initializeMarketplaceUpdateService();
      
      await updateMarketplaceAutoUpdateConfig('test-market', {
        enabled: false
      });
      
      // Verify job was cancelled
      const status = getMarketplaceUpdateServiceStatus();
      expect(status.scheduledChecks.some(c => c.marketplaceName === 'test-market')).toBe(false);
      
      shutdownMarketplaceUpdateService();
    });
  });

  describe('shutdownMarketplaceUpdateService', () => {
    it('should stop all scheduled checks', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        type: 'github',
        source: 'test/repo',
        autoUpdate: {
          enabled: true,
          checkInterval: 30
        }
      }));

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.listMarketplaces).mockReturnValue(['market1', 'market2']);
      vi.mocked(pluginPaths.getMarketplacePath).mockImplementation((name) => 
        `/test/.claude/plugins/marketplaces/${name}`
      );

      const { 
        initializeMarketplaceUpdateService,
        shutdownMarketplaceUpdateService,
        getMarketplaceUpdateServiceStatus 
      } = await import('../marketplaceUpdateService');
      
      initializeMarketplaceUpdateService();
      
      let status = getMarketplaceUpdateServiceStatus();
      expect(status.scheduledChecks.length).toBe(2);
      
      shutdownMarketplaceUpdateService();
      
      status = getMarketplaceUpdateServiceStatus();
      expect(status.isInitialized).toBe(false);
      expect(status.scheduledChecks.length).toBe(0);
    });
  });
});
