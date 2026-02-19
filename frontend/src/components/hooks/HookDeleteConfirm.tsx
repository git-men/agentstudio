import React from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/Button';
import type { PlatformHook } from '@/lib/platformHooksApi';

interface HookDeleteConfirmProps {
  hook: PlatformHook;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

export const HookDeleteConfirm: React.FC<HookDeleteConfirmProps> = ({
  hook,
  open,
  onClose,
  onConfirm,
  isDeleting,
}) => {
  const { t } = useTranslation('hooks');

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('deleteConfirm.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600 dark:text-gray-400 my-4">
          {t('deleteConfirm.message', { name: hook.name })}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isDeleting}>
            {t('deleteConfirm.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? t('deleteConfirm.deleting') : t('deleteConfirm.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
