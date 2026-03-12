const mongoose = require("mongoose");

const leaveSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      required: true,
    },
    type: { type: String, default: "휴가" },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalDaysUsed: { type: Number, required: true },
    usedSlots: [
      {
        slotId: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveSlot" },
        qty: Number,
      },
    ],
    reason: { type: String, required: true },

    // 🔥 關鍵修復點：把 CANCEL_REQ_REVIEW 和 CANCEL_REQ_APPROVAL 加入白名單
    status: {
      type: String,
      enum: [
        "PENDING_REVIEW", // 檢核待辦
        "PENDING_APPROVAL", // 批准待辦
        "APPROVED", // 批准完成 (生效)
        "REJECTED_REVIEW", // 檢核拒絕
        "REJECTED_APPROVAL", // 批准拒絕
        "CANCELLED", // 取消完成 (死亡)
        "CANCEL_REQ_REVIEW", // 🔥 新增：取消申請_檢核待辦
        "CANCEL_REQ_APPROVAL", // 🔥 新增：取消申請_批准待辦
        "CANCEL_APPROVED", // 🔥 新增：取消已批准 (變成灰色，等待勇士點擊碎裂)
      ],
      default: "PENDING_REVIEW",
    },

    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    approverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Leave", leaveSchema);
