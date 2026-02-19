import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/Button';
import { HookList } from '@/components/hooks/HookList';
import { HookForm } from '@/components/hooks/HookForm';
import { ExecutionHistory } from '@/components/hooks/ExecutionHistory';
import type { PlatformHook, HookListFilter } from '@/hooks/usePlatformHooks';

export const HooksPage: React.FC = () => {
  const { t } = useTranslation('hooks');
  const [activeTab, setActiveTab] = useState('hooks');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingHook, setEditingHook] = useState<PlatformHook | null>(null);
  const [filters, setFilters] = useState<HookListFilter>({});

  const handleEdit = (hook: PlatformHook) => {
    setEditingHook(hook);
  };

  const handleFormClose = () => {
    setShowCreateForm(false);
    setEditingHook(null);
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('page.title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('page.description')}</p>
          </div>
          <Button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>{t('actions.create')}</span>
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="hooks">{t('tabs.hooks')}</TabsTrigger>
          <TabsTrigger value="history">{t('tabs.history')}</TabsTrigger>
        </TabsList>

        <TabsContent value="hooks">
          <HookList
            filters={filters}
            onFiltersChange={setFilters}
            onEdit={handleEdit}
          />
        </TabsContent>

        <TabsContent value="history">
          <ExecutionHistory />
        </TabsContent>
      </Tabs>

      {(showCreateForm || editingHook) && (
        <HookForm
          mode={editingHook ? 'edit' : 'create'}
          initialData={editingHook ?? undefined}
          onClose={handleFormClose}
          onSuccess={handleFormClose}
        />
      )}
    </div>
  );
};
