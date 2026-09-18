export type ReportReason = 'unrelated' | 'wrong-member' | 'duplicate' | 'low-quality' | 'wrong-content' | 'other';

export type ImageReport = {
  id: string;
  imageId: string;
  reason: ReportReason;
  note: string;
  createdAt: string;
  status: 'pending' | 'dismissed' | 'rejected';
  ipHash?: string;
};
