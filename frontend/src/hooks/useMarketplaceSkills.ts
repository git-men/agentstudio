/**
 * React hooks for marketplace skill management.
 * 
 * Provides:
 * - useMarketplaceSkills: Fetch grouped skills list
 * - useToggleMarketplaceSkill: Toggle single skill
 * - useBatchToggleMarketplaceSkills: Batch toggle
 * - useToggleMarketplaceSkillGroup: Enable/disable all in group
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  marketplaceSkillsAPI,
  type MarketplaceSkillsResponse,
  type SkillToggleResult,
  type BatchToggleResult,
} from '../api/marketplaceSkills';

// Query keys
export const marketplaceSkillKeys = {
  all: ['marketplace-skills'] as const,
  list: (search?: string) => [...marketplaceSkillKeys.all, 'list', search ?? ''] as const,
};

/**
 * Fetch marketplace skills grouped by plugin.
 */
export const useMarketplaceSkills = (search?: string) => {
  return useQuery({
    queryKey: marketplaceSkillKeys.list(search),
    queryFn: () => marketplaceSkillsAPI.getGroupedSkills(search),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
};

/**
 * Toggle a single marketplace skill.
 */
export const useToggleMarketplaceSkill = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ skillId, enabled }: { skillId: string; enabled: boolean }) =>
      marketplaceSkillsAPI.toggleSkill(skillId, enabled),
    onSuccess: () => {
      // Invalidate the marketplace skills list
      queryClient.invalidateQueries({ queryKey: marketplaceSkillKeys.all });
    },
    onError: (error) => {
      console.error('Failed to toggle marketplace skill:', error);
    },
  });
};

/**
 * Batch toggle multiple marketplace skills.
 */
export const useBatchToggleMarketplaceSkills = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (actions: Array<{ skillId: string; enabled: boolean }>) =>
      marketplaceSkillsAPI.batchToggle(actions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceSkillKeys.all });
    },
    onError: (error) => {
      console.error('Failed to batch toggle marketplace skills:', error);
    },
  });
};

/**
 * Enable or disable all skills in a plugin group.
 */
export const useToggleMarketplaceSkillGroup = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      marketplaceName,
      pluginName,
      enabled,
    }: {
      marketplaceName: string;
      pluginName: string;
      enabled: boolean;
    }) =>
      enabled
        ? marketplaceSkillsAPI.enableAllInGroup(marketplaceName, pluginName)
        : marketplaceSkillsAPI.disableAllInGroup(marketplaceName, pluginName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: marketplaceSkillKeys.all });
    },
    onError: (error) => {
      console.error('Failed to toggle marketplace skill group:', error);
    },
  });
};
