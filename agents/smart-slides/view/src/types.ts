export enum SlideLayout {
  TITLE = 'Title',
  TITLE_AND_BODY = 'Title and Body',
  TWO_COLUMN = 'Two Column',
  IMAGE_FOCUSED = 'Image Focused',
  QUOTE = 'Quote'
}

export interface SlideContent {
  title: string;
  body: string[];
  imageDescription: string;
  layout: SlideLayout;
  speakerNotes?: string;
}

export interface ImageVersion {
  id: string;
  url: string;
  timestamp: number;
  title: string;
  body: string[];
  userInstruction?: string;
  referenceImageUrl?: string | null;
}

export interface Slide {
  id: string;
  content: SlideContent;
  imageUrl?: string | null;
  imageHistory?: ImageVersion[];
}

export interface PresentationStyle {
  id: string;
  name: string;
  description: string;
  previewColor: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface Presentation {
  title: string;
  userInput: string;
  styleId: string;
  resolution: '2K' | '4K';
  slides: Slide[];
  sources?: GroundingSource[];
  createdAt: number;
  updatedAt: number;
}
