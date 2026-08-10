// server/types.ts — P3 核心类型骨架
// 数据形状严格对齐 db.ts 的 legacy converters（animeToLegacy/myListToLegacy/sessionToLegacy）
// 与 scanner.ts 的 ScanNode。ServerState 对齐 server.ts makeState()。
import { ConfigShape } from './lib/config';
import { Logger } from './logger';

// ─── Episode（Anime.episodes 元素）───
export interface AnimeEpisode {
  number: number;
  filePath: string;
  fileName: string;
  fileSize: number;
  duration: number | null;
  watched: boolean;
  progress: number | null;
}

// ─── Anime（data.library 行）───
// 字段来源 animeToLegacy()；metadata extras（characters/persons/tags 等）经 JSON spread 恢复。
// 索引签名 [key: string]: any 允许运行时注入的附加字段（如 a.myListStatus），同时保留已声明字段的精确类型。
export interface Anime {
  id: string;
  folderPath: string;
  folderName: string;
  title: string;
  season: number | null;
  importedAt: string;
  downloaded: boolean;
  bangumiId: number | null;
  bangumiTitle: string | null;
  bangumiTitleJp: string | null;
  summary: string | null;
  localCover: string | null;
  rating: number | null;
  source: string | null;
  pinyinTitle: string | null;
  matchedSeason: number | null;
  anilistId: number | null;
  anilistBanner: string | null;
  anilistTitleEn: string | null;
  // 持久化 metadata 扩展字段（部分在 routes 中读写）
  characters?: any[];
  persons?: any[];
  tags?: any[];
  date?: string;
  platform?: string;
  ratingRank?: number;
  ratingTotal?: number;
  infobox?: any[];
  collection?: any;
  eps?: any[];
  totalEpisodes?: number;
  specialSuffix?: string | null;
  myListStatus?: string | null;
  episodes: AnimeEpisode[];
  [key: string]: any;
}

// ─── MyListItem（data.myList 行）───
// 字段来源 myListToLegacy()
export interface MyListItem {
  id: string;
  animeId: string | null;
  bangumiId: number | null;
  title: string;
  bangumiTitle: string | null;
  coverUrl: string | null;
  summary: string | null;
  status: string | null;
  rating: number | null;
  thoughts: string;
  notes: string;
  progress: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── PlaySession（data.playSessions 行）───
// 字段来源 sessionToLegacy()
export interface PlaySession {
  animeId: string;
  episodeNumber: number;
  sessionId: string;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  clockTime: number | null;
  progressStart: number | null;
}

// ─── ScanNode（data.scannedTree 元素）───
// 对齐 scanner.ts 的 LeafNode / BranchNode
export interface LeafNode {
  name: string;
  path: string;
  type: 'leaf';
  parsedTitle: string | null;
  cjkTitle: string | null;
  parsedSeason: number | null;
  specialSuffix: string | null;
  bangumiId: number | null;
  videoCount: number;
  totalVideoFiles: number;
  totalSize: number;
  videos: { name: string; size: number; isExtra: boolean }[];
  parentChain: string[];
  // 运行时由 routes（discovery/library）注入的可选字段
  alreadyImported?: boolean;
  excluded?: boolean;
  bangumiMatched?: boolean;
  bangumiTitleJp?: string | null;
  bangumiTitleEn?: string | null;
  metadataSource?: string | null;
  [key: string]: any;
}

export interface BranchNode {
  name: string;
  path: string;
  type: 'branch';
  children: ScanNode[];
  // 运行时由 routes 注入的可选字段（与 LeafNode 保持一致，便于联合类型属性访问）
  alreadyImported?: boolean;
  excluded?: boolean;
  bangumiMatched?: boolean;
  bangumiTitleJp?: string | null;
  bangumiTitleEn?: string | null;
  metadataSource?: string | null;
  [key: string]: any;
}

export type ScanNode = LeafNode | BranchNode;

// ─── AppData（db.loadData() 返回 / makeState().data）───
// 对齐 db.ts loadData() 的返回结构
export interface AppData {
  discovered: any[];
  library: Anime[];
  myList: MyListItem[];
  playSessions: PlaySession[];
  scannedTree: ScanNode[];
}

// ─── ActivePlay（activePlays Map 的值）───
// 对齐 routes/playback.ts 中 activePlays.set(filePath, { sessionId, episode, anime })
export interface ActivePlay {
  sessionId: string;
  episode: AnimeEpisode;
  anime: Anime;
}

// ─── ServerState（makeState() 返回值，注入每个 route handler）───
// 对齐 server.ts makeState()；db 用 typeof import('./db') 避免与 db.ts 手写签名漂移
export interface ServerState {
  data: AppData;
  config: ConfigShape;
  db: typeof import('./db');
  logger: Logger;
  activePlays: Map<string, ActivePlay>;
  cancelledSyncSessions: Map<string, boolean>;
  thumbnailQueue: any;
  bangumiPersonal: any;
  bangumiSync: any;
  pendingNotifications: any[];
  server: any;
  startupTime: number;
  saveData: (data: AppData) => Promise<void>;
  loadScannedTree: () => any;
  broadcastMpvStatus: () => void;
}
