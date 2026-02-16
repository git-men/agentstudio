import { useState, useCallback, useEffect, useRef, RefObject } from 'react';

export interface UseScrollManagementProps {
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  messages: any[];
  isAiTyping: boolean;
}

export const useScrollManagement = ({
  messagesContainerRef,
  messagesEndRef,
  messages,
  isAiTyping
}: UseScrollManagementProps) => {
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [newMessagesCount, setNewMessagesCount] = useState(0);

  // Track whether we initiated a programmatic scroll (to distinguish from user scroll)
  const isProgrammaticScrollRef = useRef(false);
  // Track previous messages length to detect new messages vs content updates
  const prevMessagesLengthRef = useRef(messages.length);
  // RAF handle for scroll event throttling
  const scrollRafRef = useRef<number | null>(null);

  // Check if scroll position is near bottom
  const isNearBottom = useCallback((threshold = 150) => {
    if (!messagesContainerRef.current) return false;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    return scrollHeight - scrollTop - clientHeight < threshold;
  }, [messagesContainerRef]);

  // Scroll to bottom — uses 'instant' during streaming to avoid animation conflicts
  const scrollToBottom = useCallback((behavior?: ScrollBehavior) => {
    isProgrammaticScrollRef.current = true;
    const effectiveBehavior = behavior || (isAiTyping ? 'instant' : 'smooth');
    messagesEndRef.current?.scrollIntoView({ behavior: effectiveBehavior });
    // Reset programmatic flag after a short delay to account for smooth scroll animation
    setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, effectiveBehavior === 'smooth' ? 300 : 50);
  }, [messagesEndRef, isAiTyping]);

  // Handle scroll event — throttled via RAF to avoid forcing layout on every event
  const handleScroll = useCallback(() => {
    // Skip if this was a programmatic scroll
    if (isProgrammaticScrollRef.current) return;

    // Throttle with RAF — only one check per animation frame
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const nearBottom = isNearBottom();
      setIsUserScrolling(!nearBottom);
      if (nearBottom) {
        setNewMessagesCount(0);
      }
    });
  }, [isNearBottom]);

  // Add scroll event listener
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => {
        container.removeEventListener('scroll', handleScroll);
        // Clean up any pending RAF
        if (scrollRafRef.current !== null) {
          cancelAnimationFrame(scrollRafRef.current);
          scrollRafRef.current = null;
        }
      };
    }
  }, [handleScroll, messagesContainerRef]);

  // Auto-scroll: only trigger on NEW messages (length change) or when AI starts typing
  // Content mutations (text deltas during streaming) change the messages array reference
  // but don't change its length — we handle those separately with a simpler check
  useEffect(() => {
    const currentLength = messages.length;
    const hadNewMessages = currentLength > prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = currentLength;

    if (hadNewMessages) {
      if (!isUserScrolling) {
        scrollToBottom();
      } else {
        setNewMessagesCount(prev => prev + 1);
      }
    }
  }, [messages.length, isUserScrolling, scrollToBottom]);

  // During streaming: periodically scroll to bottom to keep up with content updates
  // This uses a lightweight interval instead of reacting to every message mutation
  useEffect(() => {
    if (!isAiTyping || isUserScrolling) return;

    const intervalId = setInterval(() => {
      if (!isUserScrolling && isNearBottom(300)) {
        isProgrammaticScrollRef.current = true;
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
        setTimeout(() => { isProgrammaticScrollRef.current = false; }, 50);
      }
    }, 100); // Check every 100ms during streaming

    return () => clearInterval(intervalId);
  }, [isAiTyping, isUserScrolling, messagesEndRef, isNearBottom]);

  return {
    isUserScrolling,
    newMessagesCount,
    scrollToBottom,
    setNewMessagesCount,
    setIsUserScrolling
  };
};
