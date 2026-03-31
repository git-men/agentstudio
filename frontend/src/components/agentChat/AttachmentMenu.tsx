import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, Image, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface AttachmentMenuProps {
  disabled?: boolean;
  hasSelectedImages: boolean;
  fileLabel?: string;
  onImageClick: () => void;
  onFileClick: () => void;
}

export const AttachmentMenu: React.FC<AttachmentMenuProps> = ({
  disabled = false,
  hasSelectedImages,
  fileLabel,
  onImageClick,
  onFileClick
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation('components');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleImageClick = () => {
    setIsOpen(false);
    onImageClick();
  };

  const handleFileClick = () => {
    setIsOpen(false);
    onFileClick();
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-2 transition-colors rounded-lg ${
          hasSelectedImages
            ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
        title={t('agentChat.attachment.title')}
        disabled={disabled}
      >
        <Paperclip className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-44 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
          <button
            onClick={handleImageClick}
            className="w-full flex items-center space-x-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <Image className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <span>{t('agentChat.attachment.image')}</span>
          </button>
          <button
            onClick={handleFileClick}
            className="w-full flex items-center space-x-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <FileText className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <span>{fileLabel || t('agentChat.attachment.file')}</span>
          </button>
        </div>
      )}
    </div>
  );
};
