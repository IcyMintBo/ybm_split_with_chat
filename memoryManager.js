// memoryManager.js
// 这是一个“记忆管理器”的最小测试版本
// 现在只做一件事：记录轮数，并在控制台打印

const MemoryManager = {
  turnCount: 0,

  onNewTurn() {
    this.turnCount += 1;
    console.log(
      "%c[MemoryManager] 当前轮数：" + this.turnCount,
      "color: #4caf50; font-weight: bold;"
    );

    if (this.turnCount % 10 === 0) {
      console.log(
        "%c👉【触发总结】这一轮应该进行摘要",
        "color: #ff9800; font-weight: bold;"
      );
    }
  }
};

export default MemoryManager;
