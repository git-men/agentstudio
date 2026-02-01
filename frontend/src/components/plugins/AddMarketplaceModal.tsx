import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Github, GitBranch, FolderOpen, Cloud, Archive, RefreshCw } from 'lucide-react';
import { MarketplaceAddRequest, MarketplaceType } from '../../types/plugins';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '../ui/select';

interface AddMarketplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (request: MarketplaceAddRequest) => void;
  isAdding: boolean;
}

// Type configuration for display
const typeConfig: Record<MarketplaceType, { icon: React.ElementType; label: string }> = {
  github: { icon: Github, label: 'GitHub' },
  git: { icon: GitBranch, label: 'Git Repository' },
  local: { icon: FolderOpen, label: 'Local Directory' },
  cos: { icon: Cloud, label: 'COS (Tencent Cloud)' },
  archive: { icon: Archive, label: 'Archive URL' },
};

export const AddMarketplaceModal: React.FC<AddMarketplaceModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  isAdding,
}) => {
  const { t } = useTranslation('pages');
  const [formData, setFormData] = useState<MarketplaceAddRequest>({
    name: '',
    type: 'github',
    source: '',
    description: '',
    branch: 'main',
    autoUpdate: {
      enabled: false,
      checkInterval: 60,
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Clean up the request based on type
    const request: MarketplaceAddRequest = {
      name: formData.name,
      type: formData.type,
      source: formData.source,
      description: formData.description,
    };

    // Add type-specific fields
    if (formData.type === 'git' || formData.type === 'github') {
      request.branch = formData.branch;
    }

    // Add auto-update config if enabled
    if (formData.autoUpdate?.enabled) {
      request.autoUpdate = formData.autoUpdate;
    }

    onAdd(request);
    handleClose();
  };

  const handleClose = () => {
    setFormData({
      name: '',
      type: 'github',
      source: '',
      description: '',
      branch: 'main',
      autoUpdate: {
        enabled: false,
        checkInterval: 60,
      },
    });
    onClose();
  };

  // Get source placeholder based on type
  const getSourcePlaceholder = () => {
    switch (formData.type) {
      case 'local':
        return t('plugins.marketplaces.addModal.sourcePlaceholderLocal', '/path/to/marketplace');
      case 'github':
        return t('plugins.marketplaces.addModal.sourcePlaceholderGithub', 'owner/repo');
      case 'git':
        return t('plugins.marketplaces.addModal.sourcePlaceholderGit', 'https://git.example.com/repo.git');
      case 'cos':
        return 'https://bucket.cos.region.myqcloud.com/prefix';
      case 'archive':
        return 'https://example.com/marketplace.tar.gz';
      default:
        return '';
    }
  };

  const TypeIcon = typeConfig[formData.type]?.icon || Github;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-[600px] w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('plugins.marketplaces.addModal.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">{t('plugins.marketplaces.addModal.name')}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t('plugins.marketplaces.addModal.namePlaceholder')}
                required
              />
            </div>

            <div>
              <Label htmlFor="type">{t('plugins.marketplaces.addModal.type')}</Label>
              <Select
                value={formData.type}
                onValueChange={(value: string) =>
                  setFormData({ ...formData, type: value as MarketplaceType })
                }
              >
                <SelectTrigger>
                  <div className="flex items-center space-x-2">
                    <TypeIcon className="w-4 h-4" />
                    <span>{typeConfig[formData.type]?.label}</span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(typeConfig) as MarketplaceType[]).map((type) => {
                    const config = typeConfig[type];
                    const Icon = config.icon;
                    return (
                      <SelectItem key={type} value={type}>
                        <div className="flex items-center space-x-2">
                          <Icon className="w-4 h-4" />
                          <span>{config.label}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="source">{t('plugins.marketplaces.addModal.source')}</Label>
              <Input
                id="source"
                value={formData.source}
                onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                placeholder={getSourcePlaceholder()}
                required
              />
              {formData.type === 'cos' && (
                <p className="text-xs text-muted-foreground mt-1">
                  COS URL 支持公开访问的存储桶地址，或包含 marketplace.tar.gz 的目录
                </p>
              )}
              {formData.type === 'archive' && (
                <p className="text-xs text-muted-foreground mt-1">
                  支持 .tar.gz, .tgz, .zip 格式的压缩包 URL
                </p>
              )}
            </div>

            {(formData.type === 'git' || formData.type === 'github') && (
              <div>
                <Label htmlFor="branch">{t('plugins.marketplaces.addModal.branch')}</Label>
                <Input
                  id="branch"
                  value={formData.branch}
                  onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
                  placeholder={t('plugins.marketplaces.addModal.branchPlaceholder', 'main')}
                />
              </div>
            )}

            <div>
              <Label htmlFor="description">{t('plugins.marketplaces.addModal.description')}</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t('plugins.marketplaces.addModal.descriptionPlaceholder')}
              />
            </div>

            {/* Auto-update configuration */}
            {(formData.type !== 'local') && (
              <div className="space-y-3 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <RefreshCw className="w-4 h-4 text-muted-foreground" />
                    <Label htmlFor="autoUpdate" className="font-normal">
                      自动检查更新
                    </Label>
                  </div>
                  <Switch
                    id="autoUpdate"
                    checked={formData.autoUpdate?.enabled || false}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        autoUpdate: {
                          ...formData.autoUpdate,
                          enabled: checked,
                          checkInterval: formData.autoUpdate?.checkInterval || 60,
                        },
                      })
                    }
                  />
                </div>
                {formData.autoUpdate?.enabled && (
                  <div>
                    <Label htmlFor="checkInterval">检查间隔（分钟）</Label>
                    <Input
                      id="checkInterval"
                      type="number"
                      min="5"
                      value={formData.autoUpdate?.checkInterval || 60}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          autoUpdate: {
                            ...formData.autoUpdate,
                            enabled: true,
                            checkInterval: parseInt(e.target.value) || 60,
                          },
                        })
                      }
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isAdding}>
              {t('plugins.marketplaces.addModal.cancel')}
            </Button>
            <Button type="submit" disabled={isAdding}>
              {isAdding ? t('plugins.marketplaces.addModal.adding') : t('plugins.marketplaces.addModal.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

