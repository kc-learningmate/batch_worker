import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BATCH_OPTIONS } from 'src/constants/batch-options';
import { BatchService } from './batch.service';
import { BatchQueueData } from './types/types';

@Processor(BATCH_OPTIONS.QUEUE_NAME)
export class BatchConsumer extends WorkerHost {
  private readonly logger = new Logger(BatchConsumer.name);

  constructor(private readonly batchService: BatchService) {
    super();
  }

  async process(job: Job<BatchQueueData>) {
    switch (job.name) {
      case BATCH_OPTIONS.JOB_NAME:
        await this.batchService.generateContents(BigInt(job.data.keywordId));
        break;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<BatchQueueData>) {
    this.logger.log(
      `Job ${job.id} (${job.name}) completed successfully for keywordId: ${job.data.keywordId}`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<BatchQueueData>, error: Error) {
    this.logger.error(
      `Job ${job.id} (${job.name}) failed for keywordId: ${job.data.keywordId}`,
      error.stack,
    );
  }
}
