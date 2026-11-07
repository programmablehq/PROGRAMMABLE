import type { ProjectRevision, RunSnapshot } from "@/lib/custom-ai/platform/protocol.generated";
import type { ConnectionManifest } from "@/lib/custom-ai/platform/connections.server";
export type { ProjectRevision, ConnectionManifest };
export type ProjectItem = {projectId:string;revisionId:string;title:string;updatedAt:string};
export type RevisionItem = {revisionId:string;parentRevisionId:string|null;ordinal:number;createdAt:string;title:string};
export type ProjectRun = RunSnapshot & {prompt:string;operation:"plan"|"build"|"test"|"deploy";summary?:string;createdAt:string;reservedUnits:number;usedUnits:number};
export type Connection = {id:string;version:string;manifest:ConnectionManifest;allowedActions:string[];state:string};
export type Release = {id:string;revisionId:string;state:string;mode:string;url:string|null;errorCode:string|null;observedAt:string|null};
export type PlatformAPI = <T>(path:string, options?:{method?:"GET"|"POST"|"PATCH"|"DELETE";body?:unknown;signal?:AbortSignal})=>Promise<T>;
