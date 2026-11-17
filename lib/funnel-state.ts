// Pure reducer: pipeline events -> what the live funnel shows. Kept out of the component so it's testable.
import { BOARDS } from "./board-list";
import type { BoardStatus, Funnel, PipelineEvent, Stage } from "./types";

export type StageKey = keyof Funnel;
export type FunnelState = {
  boards: Record<string, BoardStatus | undefined>;
  stages: Record<StageKey, { count: number; done: boolean }>;
  cost: Partial<Record<Stage, number>>;
  totalUsd: number;
  cached: boolean;
  finished: boolean;
  digests: { cached: number; computed: number } | null;
};

export const initialFunnel = (): FunnelState => ({
  boards: Object.fromEntries(BOARDS.map((b) => [b.company, undefined])),
  stages: {
    scanned: { count: 0, done: false },
    prefiltered: { count: 0, done: false },
    scored: { count: 0, done: false },
    explained: { count: 0, done: false },
  },
  cost: {},
  totalUsd: 0,
  cached: false,
  finished: false,
  digests: null,
});

export function funnelReducer(state: FunnelState, e: PipelineEvent | { type: "reset" }): FunnelState {
  switch (e.type) {
    case "reset":
      return initialFunnel();
    case "cached":
      return { ...state, cached: true };
    case "digest":
      return { ...state, digests: { cached: e.cached, computed: e.computed } };
    case "board":
      return { ...state, boards: { ...state.boards, [e.board.company]: e.board } };
    case "stage":
      return { ...state, stages: { ...state.stages, [e.stage]: { count: e.count, done: e.done } } };
    case "cost":
      return { ...state, cost: { ...state.cost, [e.stage]: e.stageUsd }, totalUsd: e.totalUsd };
    case "result":
    case "error":
      return { ...state, finished: true };
  }
}
