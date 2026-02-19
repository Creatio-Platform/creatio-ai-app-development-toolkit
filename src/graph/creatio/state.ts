import { Annotation } from '@langchain/langgraph';
import type { ParsedCreatioIntent } from '../../agent/creatioIntentParser.js';

export type CreatioGraphResponse = Record<string, unknown>;

export const CreatioGraphState = Annotation.Root({
  text: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  intent: Annotation<ParsedCreatioIntent | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  operation: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  language: Annotation<'uk' | 'en'>({
    reducer: (_left, right) => right,
    default: () => 'en',
  }),
  schemaName: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  schemaType: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => 'AngularSchema',
  }),
  parentSchemaName: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  userLevelSchema: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),
  templateUId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  templateName: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  templateOptions: Annotation<Array<Record<string, unknown>>>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  finalResponse: Annotation<CreatioGraphResponse | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
});

export type CreatioGraphStateType = typeof CreatioGraphState.State;
