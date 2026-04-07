import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SlashCommand } from '../types/commands';
import type { SkillListItem } from '../types/skills';
import { useCommands, useProjectCommands } from '../hooks/useCommands';
import { useSkills } from '../hooks/useSkills';
import { SystemCommand, SkillSlashItem } from '../utils/commandHandler';

interface CommandSelectorProps {
  isOpen: boolean;
  onSelect: (command: SlashCommand | SystemCommand | SkillSlashItem) => void;
  onClose?: () => void;
  searchTerm: string;
  position: { top: number; left: number };
  projectId?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  selectedIndex?: number;
  onSelectedIndexChange?: (index: number) => void;
}

// SystemCommand is now imported from commandHandler

// Helper function to create system commands with translations
const createSystemCommands = (t: (key: string) => string): SystemCommand[] => [
  {
    id: 'init',
    name: 'init',
    description: t('commandSelector.systemCommands.init.description'),
    content: '/init',
    scope: 'system',
    isSystem: true
  },
  {
    id: 'clear',
    name: 'clear',
    description: t('commandSelector.systemCommands.clear.description'),
    content: '/clear',
    scope: 'system',
    isSystem: true
  },
  {
    id: 'compact',
    name: 'compact',
    description: t('commandSelector.systemCommands.compact.description'),
    content: '/compact',
    scope: 'system',
    isSystem: true
  },
  {
    id: 'agents',
    name: 'agents',
    description: t('commandSelector.systemCommands.agents.description'),
    content: '/agents',
    scope: 'system',
    isSystem: true
  },
  {
    id: 'settings',
    name: 'settings',
    description: t('commandSelector.systemCommands.settings.description'),
    content: '/settings',
    scope: 'system',
    isSystem: true
  },
  {
    id: 'help',
    name: 'help',
    description: t('commandSelector.systemCommands.help.description'),
    content: '/help',
    scope: 'system',
    isSystem: true
  },
];

export const CommandSelector: React.FC<CommandSelectorProps> = ({
  isOpen,
  onSelect,
  onClose,
  searchTerm,
  position,
  projectId,
  // onKeyDown,
  selectedIndex = 0,
  onSelectedIndexChange,
}) => {
  const { t } = useTranslation('components');
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose?.();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose]);
  // Fetch commands
  const { data: userCommandsData } = useCommands({ scope: 'user', search: searchTerm });
  const { data: projectCommandsData } = useProjectCommands({
    projectId: projectId || '',
    search: searchTerm
  });

  // Fetch skills
  const { data: userSkillsData } = useSkills({ scope: 'user' });
  const { data: projectSkillsData } = useSkills({ scope: 'project' });

  // Extract commands arrays from response objects
  const userCommands = userCommandsData?.commands || [];
  const projectCommands = projectCommandsData?.commands || [];

  // Create system commands with translations
  const systemCommands = createSystemCommands(t);

  // Filter system commands based on search term
  const filteredSystemCommands = systemCommands.filter(cmd =>
    cmd.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    cmd.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Convert skills to SkillSlashItem format
  const convertSkills = useCallback((skills: SkillListItem[], scope: 'user' | 'project'): SkillSlashItem[] => {
    if (!Array.isArray(skills)) return [];
    return skills
      .filter(s => s.enabled !== false)
      .map(skill => ({
        id: `skill-${skill.id}`,
        name: skill.name,
        description: skill.description || '',
        content: '',
        scope,
        isSkill: true as const,
      }));
  }, []);

  const skillItems = useMemo(() => {
    const user = convertSkills(userSkillsData || [], 'user');
    const project = convertSkills(projectSkillsData || [], 'project');
    if (!searchTerm) return [...project, ...user];
    const search = searchTerm.toLowerCase();
    return [...project, ...user].filter(s =>
      s.name.toLowerCase().includes(search) ||
      s.description.toLowerCase().includes(search)
    );
  }, [userSkillsData, projectSkillsData, searchTerm, convertSkills]);

  // Combine all commands and skills
  const allCommands: (SlashCommand | SystemCommand | SkillSlashItem)[] = [
    ...filteredSystemCommands,
    ...projectCommands,
    ...userCommands,
    ...skillItems,
  ];

  // Reset selectedIndex when commands change
  useEffect(() => {
    if (allCommands.length > 0 && selectedIndex >= allCommands.length) {
      onSelectedIndexChange?.(0);
    }
  }, [allCommands.length, selectedIndex, onSelectedIndexChange]);

  // Scroll to selected item
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const selectedItem = containerRef.current.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement;
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex, isOpen]);

  if (!isOpen || allCommands.length === 0) return null;

  // Calculate dynamic height based on number of commands and viewport
  const itemHeight = 65; // Approximate height per command item
  const padding = 20; // Extra padding to ensure it doesn't touch viewport edges
  const fixedGap = 4; // Fixed gap between selector and input
  // Since the popup shows above the input, available height is from top of viewport to input position minus gap
  const maxAvailableHeight = position.top - padding - fixedGap;
  const idealHeight = allCommands.length * itemHeight;
  const dynamicHeight = Math.min(idealHeight, maxAvailableHeight);

  return (
    <div
      ref={containerRef}
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-72 max-w-96 overflow-hidden"
      style={{
        bottom: window.innerHeight - position.top + fixedGap, // Fixed distance from input
        left: position.left,
        maxHeight: `${dynamicHeight}px`,
      }}
    >
      <div className="overflow-y-auto" style={{ maxHeight: `${dynamicHeight}px` }}>
        {allCommands.map((command, index) => {
          const isSystem = 'isSystem' in command;
          const isSkill = 'isSkill' in command;
          const isSelected = index === selectedIndex;

          const getDisplayName = () => {
            if (isSystem || isSkill) {
              return command.name;
            }
            if ((command as SlashCommand).namespace) {
              return `${(command as SlashCommand).namespace}:${command.name}`;
            }
            return command.name;
          };

          const getTypeBadge = () => {
            if (isSkill) {
              return (
                <span className="ml-2 flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                  {t('commandSelector.typeBadge.skill')}
                </span>
              );
            }
            if (isSystem) {
              return (
                <span className="ml-2 flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                  {t('commandSelector.typeBadge.system')}
                </span>
              );
            }
            return (
              <span className="ml-2 flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                {t('commandSelector.typeBadge.command')}
              </span>
            );
          };

          return (
            <div
              key={command.id}
              data-index={index}
              className={`px-4 py-3 cursor-pointer flex items-center border-b border-gray-100 dark:border-gray-700 last:border-b-0 ${
                isSelected
                  ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
              onClick={() => onSelect(command)}
              onMouseEnter={() => onSelectedIndexChange?.(index)}
            >
              <div className="flex-1 min-w-0">
                <div className={`flex items-center text-sm font-medium ${
                  isSelected ? 'text-blue-900 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'
                }`}>
                  <span className="truncate">{getDisplayName()}</span>
                  {getTypeBadge()}
                </div>
                {command.description && (
                  <div className={`text-xs truncate mt-0.5 ${
                    isSelected ? 'text-blue-700 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'
                  }`}>
                    {command.description}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Export helper function to get selected command
export const getSelectedCommand = (
  allCommands: (SlashCommand | SystemCommand | SkillSlashItem)[],
  selectedIndex: number
): SlashCommand | SystemCommand | SkillSlashItem | null => {
  return allCommands[selectedIndex] || null;
};