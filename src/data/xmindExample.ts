import type { Book, MindmapNode } from '../types';

// xmind-import.json의 구조와 색상. 기존 브라우저 편집본이 있으면 그 내용을 우선한다.
export const xmindExampleBook: Book = {
  "id": "7b0d6c1e-3f4a-4c2b-9e58-2a1f6d0c4b91",
  "title": "Central Topic",
  "author": null,
  "status": "want",
  "rating": null,
  "spine_color": "#4a6fa5",
  "page_count": null,
  "cover_url": null,
  "tags": [
    "xmind"
  ],
  "shelf_order": 0,
  "started_on": null,
  "finished_on": null,
  "created_at": "2026-11-15T09:00:00+09:00",
  "updated_at": "2026-11-15T09:00:00+09:00",
  "user_id": "demo"
};

export const xmindExampleNodes: MindmapNode[] = [
  {
    "id": "x-root",
    "parentId": null,
    "text": "Central Topic",
    "color": "#4a6fa5",
    "collapsed": false,
    "order": 0
  },
  {
    "id": "x-m1",
    "parentId": "x-root",
    "text": "Main Topic 1",
    "color": "#f0605a",
    "collapsed": false,
    "order": 0
  },
  {
    "id": "x-m2",
    "parentId": "x-root",
    "text": "Main Topic 2",
    "color": "#f59a4c",
    "collapsed": false,
    "order": 1
  },
  {
    "id": "x-m3",
    "parentId": "x-root",
    "text": "Main Topic 3",
    "color": "#8fd3b0",
    "collapsed": false,
    "order": 2
  },
  {
    "id": "x-m4",
    "parentId": "x-root",
    "text": "Main Topic 4",
    "color": "#7fd6c8",
    "collapsed": false,
    "order": 3
  },
  {
    "id": "x-m5",
    "parentId": "x-root",
    "text": "Main Topic 5",
    "color": "#6ec6f0",
    "collapsed": false,
    "order": 4
  },
  {
    "id": "x-m5-s1",
    "parentId": "x-m5",
    "text": "Subtopic 1",
    "color": "#6ec6f0",
    "collapsed": false,
    "order": 0
  },
  {
    "id": "x-m5-s2",
    "parentId": "x-m5",
    "text": "Subtopic 2",
    "color": "#6ec6f0",
    "collapsed": false,
    "order": 1
  }
];
