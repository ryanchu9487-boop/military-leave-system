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
      ref: "Organization",
    },
    type: {
      type: String,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    totalDaysUsed: {
      type: Number,
      required: true,
    },
    usedSlots: [
      {
        slotId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "LeaveSlot",
          required: true,
        },
        qty: { type: Number, required: true },
      },
    ],
    reason: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "PENDING_REVIEW",
        "PENDING_APPROVAL",
        "APPROVED",
        "REJECTED_REVIEW",
        "REJECTED_APPROVAL",
        "CANCELLED",
        "CANCEL_REQ_REVIEW",
        "CANCEL_REQ_APPROVAL",
        "CANCEL_APPROVED",
        "FORCE_CANCELLED", // 🔥 已經將強制取消加入白名單！
      ],
      default: "PENDING_REVIEW",
    },

    // 📂 勇士申請時上傳的多個證明文件路徑
    evidenceFiles: [
      {
        type: String,
      },
    ],

    // ==========================================
    // 🔥 [本次升級新增] 演算法與檢討者權限核心欄位
    // ==========================================
    isWaitlisted: {
      type: Boolean,
      default: false, // true 代表因出島率額滿，掉入候補區 (후보)
    },
    isManualOverride: {
      type: Boolean,
      default: false, // true 代表檢討者手動介入過，系統不得覆蓋
    },
    priorityScore: {
      type: Number,
      default: 0, // 系統算出來的優先順位積分，越高越優先
    },
    // ==========================================

    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reviewedAt: {
      type: Date,
    },
    approverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Leave", leaveSchema);
