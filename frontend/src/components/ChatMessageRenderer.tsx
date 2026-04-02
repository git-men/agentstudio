import React, { useState, memo } from 'react';
import { MarkdownMessage } from './MarkdownMessage';
import { ToolUsage } from './ToolUsage';
import { ImagePreview } from './ImagePreview';
import { CompactSummary } from './CompactSummary';
import { A2UIRenderer } from './a2ui';
import type { ChatMessage } from '../types/index';

type TextSegment = { kind: 'text'; content: string } | { kind: 'thinking'; content: string };

/**
 * Split a text string on `<think>…</think>` boundaries.
 *
 * Handles three cases:
 *  1. Fully closed tags  → `<think>content</think>`
 *  2. Unclosed tag (still streaming) → `<think>partial…`
 *  3. No tags at all → returns the whole string as a text segment
 */
function parseThinkTags(raw: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      const before = raw.slice(lastIndex, match.index).trim();
      if (before) segments.push({ kind: 'text', content: before });
    }
    const inner = match[1].trim();
    if (inner) segments.push({ kind: 'thinking', content: inner });
    lastIndex = match.index + match[0].length;
  }

  const tail = raw.slice(lastIndex);

  // Unclosed <think> — treat remainder as in-progress thinking
  const openIdx = tail.indexOf('<think>');
  if (openIdx !== -1) {
    const before = tail.slice(0, openIdx).trim();
    if (before) segments.push({ kind: 'text', content: before });
    const inner = tail.slice(openIdx + '<think>'.length).trim();
    if (inner) segments.push({ kind: 'thinking', content: inner });
  } else {
    // Handle orphaned </think> (SDK sometimes strips opening <think> in stored messages)
    const closeIdx = tail.indexOf('</think>');
    if (closeIdx !== -1) {
      const thinkingContent = tail.slice(0, closeIdx).trim();
      const afterClose = tail.slice(closeIdx + '</think>'.length).trim();
      if (thinkingContent) segments.push({ kind: 'thinking', content: thinkingContent });
      if (afterClose) segments.push({ kind: 'text', content: afterClose });
    } else {
      const trimmed = tail.trim();
      if (trimmed) segments.push({ kind: 'text', content: trimmed });
    }
  }

  return segments;
}

const ThinkingBlock: React.FC<{ content: string }> = ({ content }) => (
  <details className="my-2" open>
    <summary className="cursor-pointer text-gray-500 dark:text-gray-400 text-sm hover:text-gray-700 dark:hover:text-gray-300 transition-colors select-none">
      💭 思考过程...
    </summary>
    <div className="mt-2 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
      <div className="text-gray-600 dark:text-gray-300 text-sm whitespace-pre-wrap break-words leading-relaxed italic">
        {content}
      </div>
    </div>
  </details>
);

interface ChatMessageRendererProps {
  message: ChatMessage;
  onFrontendToolSubmit?: (toolCallId: string, result: unknown) => Promise<{ success: boolean; error?: string }>;
  onFrontendToolCancel?: (toolCallId: string, reason?: string) => void;
  projectPath?: string;
}

const ChatMessageRendererComponent: React.FC<ChatMessageRendererProps> = ({ message, onFrontendToolSubmit, onFrontendToolCancel, projectPath }) => {
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number>(0);

  // Collect all image URLs from the message
  const getAllImageUrls = () => {
    const imageUrls: string[] = [];
    
    // From messageParts
    if (message.messageParts && message.messageParts.length > 0) {
      message.messageParts.forEach(part => {
        if (part.type === 'image' && part.imageData) {
          imageUrls.push(`data:${part.imageData.mediaType};base64,${part.imageData.data}`);
        }
      });
    }
    
    // From legacy images
    if (message.images && message.images.length > 0) {
      message.images.forEach(image => {
        imageUrls.push(`data:${image.mediaType};base64,${image.data}`);
      });
    }
    
    return imageUrls;
  };

  // Open image preview
  const openImagePreview = (clickedImageUrl: string) => {
    const allImages = getAllImageUrls();
    const clickedIndex = allImages.indexOf(clickedImageUrl);
    setPreviewImages(allImages);
    setPreviewIndex(clickedIndex >= 0 ? clickedIndex : 0);
  };

  // Close image preview
  const closeImagePreview = () => {
    setPreviewImages([]);
    setPreviewIndex(0);
  };

  // Use messageParts if available, otherwise fall back to legacy content + toolUsage
  if (message.messageParts && message.messageParts.length > 0) {
    const sortedParts = [...message.messageParts].sort((a, b) => a.order - b.order);
    
    return (
      <div className="space-y-3">
        {/* Render images from message.images (e.g., loaded from session history) */}
        {message.images && message.images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.images.map((image) => {
              const imageUrl = `data:${image.mediaType};base64,${image.data}`;
              return (
                <img
                  key={image.id}
                  src={imageUrl}
                  alt={image.filename || 'Image'}
                  className="max-w-32 max-h-32 object-cover rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => openImagePreview(imageUrl)}
                  title={image.filename || 'Click to preview'}
                />
              );
            })}
          </div>
        )}
        {sortedParts.map((part) => {
          if (part.type === 'command' && part.content) {
            // 分离命令名和参数
            const commandContent = part.content.trim();
            const spaceIndex = commandContent.indexOf(' ');
            const commandName = spaceIndex > 0 ? commandContent.substring(0, spaceIndex) : commandContent;
            const commandArgs = spaceIndex > 0 ? commandContent.substring(spaceIndex + 1).trim() : '';
            
            return (
              <div key={part.id} className="flex items-center gap-2">
                <span className="inline-flex items-center px-2.5 py-1 bg-gray-800 dark:bg-gray-900 text-emerald-400 dark:text-emerald-300 rounded-md text-sm font-mono font-medium">
                  {commandName}
                </span>
                {commandArgs && (
                  <span className="text-gray-100 text-sm">
                    {commandArgs}
                  </span>
                )}
              </div>
            );
          } else if (part.type === 'compactSummary' && part.content) {
            return (
              <div key={part.id}>
                <CompactSummary content={part.content} />
              </div>
            );
          } else if (part.type === 'text' && part.content && part.content.includes('unknown')) {
            // Handle legacy thinking content that was saved as "unknown" type
            // Check if the content contains thinking-related markers
            const isThinkingContent = part.content.includes('"type":"thinking"') || 
                                    part.content.includes('"thinking"') ||
                                    part.content.includes('thinking');
            
            if (isThinkingContent) {
              // Extract thinking content from the serialized data
              let thinkingText = part.content;

              // Try to parse if it looks like JSON and extract thinking content
              try {
                if (part.content.includes('"thinking":')) {
                  const match = part.content.match(/"thinking":"([^"]+)"/);
                  if (match && match[1]) {
                    thinkingText = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                  }
                }
              } catch (e) {
                // If parsing fails, use the original content
                console.warn('Failed to parse thinking content:', e);
              }

              return <ThinkingBlock key={part.id} content={thinkingText} />;
            } else {
              // For other unknown types, render as text
              return (
                <div key={part.id}>
                  <MarkdownMessage content={part.content} isUserMessage={message.role === 'user'} />
                </div>
              );
            }
          } else if (part.type === 'text' && part.content) {
            const segments = parseThinkTags(part.content);
            const hasThinkSegments = segments.some(s => s.kind === 'thinking');
            if (hasThinkSegments) {
              return (
                <div key={part.id}>
                  {segments.map((seg, idx) =>
                    seg.kind === 'thinking'
                      ? <ThinkingBlock key={`${part.id}-seg-${idx}`} content={seg.content} />
                      : <MarkdownMessage key={`${part.id}-seg-${idx}`} content={seg.content} isUserMessage={message.role === 'user'} />
                  )}
                </div>
              );
            }
            return (
              <div key={part.id}>
                <MarkdownMessage content={part.content} isUserMessage={message.role === 'user'} />
              </div>
            );
          } else if (part.type === 'thinking' && part.content) {
            return <ThinkingBlock key={part.id} content={part.content} />;
          } else if (part.type === 'tool' && part.toolData) {
            return (
              <ToolUsage
                key={part.id}
                toolName={part.toolData.toolName}
                toolInput={part.toolData.toolInput}
                toolResult={part.toolData.toolResult}
                toolUseResult={part.toolData.toolUseResult}
                isError={part.toolData.isError}
                isExecuting={part.toolData.isExecuting}
                claudeId={part.toolData.claudeId}
                onFrontendToolSubmit={onFrontendToolSubmit}
                onFrontendToolCancel={onFrontendToolCancel}
              />
            );
          } else if (part.type === 'image' && part.imageData) {
            const imageUrl = `data:${part.imageData.mediaType};base64,${part.imageData.data}`;
            return (
              <div key={part.id} className="inline-block">
                <img
                  src={imageUrl}
                  alt={part.imageData.filename || 'Image'}
                  className="max-w-32 max-h-32 object-cover rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => openImagePreview(imageUrl)}
                  title={part.imageData.filename || 'Click to preview'}
                />
              </div>
            );
          } else if (part.type === 'a2ui' && part.a2uiData) {
            return (
              <div key={part.id} className="a2ui-message-part my-2">
                <A2UIRenderer
                  messages={part.a2uiData.messages}
                  className="rounded-lg"
                />
              </div>
            );
          }
          return null;
        })}
        
        <ImagePreview 
          images={previewImages} 
          initialIndex={previewIndex}
          onClose={closeImagePreview}
          projectPath={projectPath}
        />
      </div>
    );
  }

  // Legacy fallback
  return (
    <div className="space-y-2">
      {/* Images */}
      {message.images && message.images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {message.images.map((image) => {
            const imageUrl = `data:${image.mediaType};base64,${image.data}`;
            return (
              <img
                key={image.id}
                src={imageUrl}
                alt={image.filename || 'Image'}
                className="max-w-32 max-h-32 object-cover rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => openImagePreview(imageUrl)}
                title={image.filename || 'Click to preview'}
              />
            );
          })}
        </div>
      )}
      
      {/* Text content */}
      {message.content && (
        <div>
          {(() => {
            // Check if this is a command message format
            const commandMatch = message.content.match(
              /<command-message>.*?<\/command-message>\s*<command-name>(.+?)<\/command-name>/
            );
            
            if (commandMatch) {
              // 分离命令名和参数
              const commandContent = commandMatch[1].trim();
              const spaceIndex = commandContent.indexOf(' ');
              const commandName = spaceIndex > 0 ? commandContent.substring(0, spaceIndex) : commandContent;
              const commandArgs = spaceIndex > 0 ? commandContent.substring(spaceIndex + 1).trim() : '';
              
              // Render as command block
              return (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-1 bg-gray-800 dark:bg-gray-900 text-emerald-400 dark:text-emerald-300 rounded-md text-sm font-mono font-medium">
                    {commandName}
                  </span>
                  {commandArgs && (
                    <span className="text-gray-100 text-sm">
                      {commandArgs}
                    </span>
                  )}
                </div>
              );
            } else {
              // Regular text content - always use MarkdownMessage for consistent styling
              return (
                <MarkdownMessage content={message.content} isUserMessage={message.role === 'user'} />
              );
            }
          })()}
        </div>
      )}
      
      {/* Tool usage components */}
      {message.toolUsage && message.toolUsage.length > 0 && (
        <div className="space-y-2">
          {message.toolUsage.map((tool) => (
            <ToolUsage
              key={tool.id}
              toolName={tool.toolName}
              toolInput={tool.toolInput}
              toolResult={tool.toolResult}
              toolUseResult={tool.toolUseResult}
              isError={tool.isError}
              isExecuting={tool.isExecuting}
              claudeId={tool.claudeId}
              onFrontendToolSubmit={onFrontendToolSubmit}
              onFrontendToolCancel={onFrontendToolCancel}
            />
          ))}
        </div>
      )}
      
      <ImagePreview 
        images={previewImages} 
        initialIndex={previewIndex}
        onClose={closeImagePreview}
        projectPath={projectPath}
      />
    </div>
  );
};

export const ChatMessageRenderer = memo(ChatMessageRendererComponent);