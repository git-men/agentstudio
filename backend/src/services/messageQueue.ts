/**
 * 异步消息队列，用于持续向 Claude 提供用户输入
 * 实现 Streaming Input Mode 的核心组件
 */
export class MessageQueue {
  private queue: any[] = [];
  private resolvers: Array<(value: any) => void> = [];
  private isEnded = false;

  /**
   * 异步迭代器实现，用于 Claude SDK 的 streaming input
   */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<any> {
    while (!this.isEnded || this.queue.length > 0) {
      if (this.queue.length > 0) {
        const message = this.queue.shift();
        // 跳过 null 消息，避免在队列结束时发送 null
        if (message !== null && message !== undefined) {
          yield message;
        }
      } else if (!this.isEnded) {
        // 等待新消息
        const message = await new Promise<any>(resolve => this.resolvers.push(resolve));
        // 如果收到 null，说明队列已结束，直接退出
        if (message === null || message === undefined) {
          break;
        }
        yield message;
      }
    }
  }

  /**
   * 向队列中添加消息
   * @param message 要添加的消息
   */
  push(message: any): void {
    console.log(`🔧 [QUEUE] push called, isEnded: ${this.isEnded}, resolvers: ${this.resolvers.length}, queue: ${this.queue.length}`);
    
    if (this.isEnded) {
      console.warn('Cannot push to ended message queue');
      return;
    }

    if (this.resolvers.length > 0) {
      // 有等待的消费者，直接解析
      console.log(`🔧 [QUEUE] Resolving waiting consumer`);
      const resolve = this.resolvers.shift()!;
      resolve(message);
    } else {
      // 没有等待的消费者，加入队列
      console.log(`🔧 [QUEUE] Adding to queue`);
      this.queue.push(message);
    }
  }

  /**
   * 结束队列，不再接收新消息
   */
  end(): void {
    this.isEnded = true;
    // 解析所有等待的 promise
    this.resolvers.forEach(resolve => resolve(null));
    this.resolvers = [];
  }

  /**
   * 检查队列是否已结束
   */
  isFinished(): boolean {
    return this.isEnded;
  }

  /**
   * 获取当前队列长度
   */
  size(): number {
    return this.queue.length;
  }
}