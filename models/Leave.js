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
      ],
      default: "PENDING_REVIEW",
    },
    
    // 🔥 [新增] 勇士申請時上傳的多個證明文件路徑
    evidenceFiles: [
      {
        type: String,
      }
    ],

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