const mongoose = require("mongoose");

const leaveSchema = new mongoose.Schema(
  {
    // 🔐 Multi-Tenant 핵심
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      required: true,
      index: true,
    },

    // 📅 기간
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },

    totalDaysUsed: {
      type: Number,
      required: true,
      min: 0.5,
    },

    // 🎟 사용한 휴가 슬롯
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

    // 🔄 3단계 상태 흐름
    status: {
      type: String,
      enum: [
        "PENDING_REVIEW", // 검토대기
        "PENDING_APPROVAL", // 승인대기
        "APPROVED", // 승인완료
        "REJECTED_REVIEW", // 검토거절
        "REJECTED_APPROVAL", // 승인거절
        "CANCELLED",
      ],
      default: "PENDING_REVIEW",
      index: true,
    },

    // 👮 검토자
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    reviewedAt: Date,

    // ⭐ 승인자
    approverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    approvedAt: Date,

    // ❌ 반려 사유
    rejectReason: { type: String },

    // 📝 신청 사유
    reason: { type: String, trim: true },
  },
  {
    timestamps: true,
  }
);

//
// 🔐 Multi-Tenant 인덱스 설계
//

// 조직 + 사용자 + 기간 조회 최적화
leaveSchema.index({
  organizationId: 1,
  userId: 1,
  startDate: 1,
  endDate: 1,
});

// 조직 + 날짜별 승인 인원 체크용
leaveSchema.index({
  organizationId: 1,
  startDate: 1,
  status: 1,
});

module.exports = mongoose.model("Leave", leaveSchema);
