/**
 * Cursor Engine Module
 * 
 * Exports the Cursor engine implementation and its adapters.
 * - AGUI Adapter: Converts Cursor CLI output to AGUI events
 * - A2A Adapter: Converts AGUI events to A2A protocol format
 */

export { CursorEngine, cursorEngine } from './cursorEngine.js';
export { CursorAguiAdapter } from './aguiAdapter.js';
export { 
  CursorA2AAdapter,
  convertAGUIEventsToA2A,
  createA2AErrorResponse,
  A2A_ERROR_CODES,
  type A2AStreamingResponse,
  type A2ATask,
  type A2AMessage,
  type A2ATaskState,
  type A2ATaskStatus,
  type A2AArtifact,
  type A2APart,
  type A2ATextPart,
  type A2AFilePart,
  type A2ADataPart,
  type A2ATaskStatusUpdateEvent,
  type A2ATaskArtifactUpdateEvent,
} from './a2aAdapter.js';
