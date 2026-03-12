const mongoose = require("mongoose");

const leaveSlotSchema = new mongoose.Schema(
  {
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
    // 🔥 擴充 enum，讓 연가(휴가), 기타, 특별 都能順利存入資料庫
    type: {
      type: String,
      required: true,
      enum: [
        "포상",
        "위로",
        "보상",
        "외박",
        "외출",
        "휴가",
        "기타",
        "특별",
        "평일특별",
        "주말특별",
      ],
      index: true,
    },
    reason: { type: String, required: true, trim: true },
    totalCount: { type: Number, required: true, min: 0 },
    remains: { type: Number, required: true, min: 0 },
    evidenceFile: { type: String, default: null },
    acquiredAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, index: true },
    status: {
      type: String,
      enum: ["active", "expired", "revoked"],
      default: "active",
      index: true,
    },
    description: String,
    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

leaveSlotSchema.index({
  organizationId: 1,
  userId: 1,
  remains: 1,
  expiresAt: 1,
});
leaveSlotSchema.index({ organizationId: 1, type: 1 });

module.exports = mongoose.model("LeaveSlot", leaveSlotSchema);
