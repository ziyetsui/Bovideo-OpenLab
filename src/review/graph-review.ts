import { CandidateEdgeReviewService, type CandidateEdgeReviewCommand, type ReviewResult } from '../graph/review'

export const reviewCandidateEdge = (service: CandidateEdgeReviewService, command: CandidateEdgeReviewCommand): Promise<ReviewResult> => service.review(command)

export class GraphReviewService extends CandidateEdgeReviewService {}
