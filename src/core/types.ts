export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json };
export type Properties = Record<string, Json | undefined>;

export interface BaseMessage {
  messageId: string;
  anonymousId: string;
  userId?: string;
  userHash?: string;
  timestamp: string;
  context: Properties;
}

export interface TrackMessage extends BaseMessage {
  type: 'track';
  event: string;
  properties: Properties;
}

export interface PageMessage extends BaseMessage {
  type: 'page';
  properties: Properties;
}

export interface IdentifyMessage extends BaseMessage {
  type: 'identify';
  traits: Properties;
}

export type Message = TrackMessage | PageMessage | IdentifyMessage;

export interface Storage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface TransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export type Transport = (request: TransportRequest) => Promise<number>;
