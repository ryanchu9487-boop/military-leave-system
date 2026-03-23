const mongoose = require("mongoose");

const letterSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true },
    // Q1 & Q2: 兵營不合理現象
    q1_absurdity: { type: String, enum: ['있다', '없다'], required: true },
    q2_absurdityDetail: { type: String, default: "" },
    // Q3 & Q4: 毆打、暴言、侮辱
    q3_abuse: { type: String, enum: ['있다', '없다'], required: true },
    q4_abuseDetail: { type: String, default: "" },
    // Q5 & Q6: 性相關違規
    q5_sexual: { type: String, enum: ['있다', '없다'], required: true },
    q6_sexualDetail: { type: String, default: "" },
    // Q7 & Q8: 金錢交易
    q7_money: { type: String, enum: ['있다', '없다'], required: true },
    q8_moneyDetail: { type: String, default: "" },
    // Q9: 稱讚
    q9_praise: { type: String, default: "" },
    // Q10: 建議與苦衷
    q10_suggestion: { type: String, default: "" },
    
    // 長官後台標記用
    isRead: { type: Boolean, default: false }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Letter", letterSchema);