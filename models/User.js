const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { passwordValidator } = require("../src/utils/validators");

const SALT_ROUNDS = 10;

const userSchema = new mongoose.Schema(
  {
    // --- 소속 ---
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },

    // --- 기본 정보 ---
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    rank: {
      type: String,
      required: true,
      trim: true,
    },

    serviceNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    phoneNumber: {
      type: String,
      required: true,
      trim: true,
      // 유효성 검사 예시 (010-1234-5678)
      validate: {
        validator: function (v) {
          return /^\d{3}-\d{3,4}-\d{4}$/.test(v);
        },
        message: (props) => `${props.value}는 올바른 전화번호 형식이 아닙니다!`,
      },
    },

    password: {
      type: String,
      required: true,
      select: false,
      validate: passwordValidator,
    },

    // --- 군용 단일 권한 ---
    role: {
      type: String,
      // 增加 officer (간부), 保留 reviewer (검토자), approver (승인자)
      enum: [
        "soldier",
        "officer",
        "reviewer",
        "approver",
        "admin",
        "superadmin",
      ],
      default: "soldier",
      index: true,
    },

    // --- 승인 상태 ---
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    // --- 🔥 [보안 및 비밀번호 초기화 메커니즘] ---
    resetRequested: { type: Boolean, default: false }, // 용사가 비밀번호 초기화를 요청했을 때 true
    forceChangePassword: { type: Boolean, default: false }, // 간부가 초기화 승인 후, 다음 로그인 시 강제 변경을 요구할 때 true

    isActive: { type: Boolean, default: true, index: true },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    lastLoginAt: { type: Date },

    // --- 🔥 [군 생활 및 진급 관련 날짜] ---
    enlistmentDate: { type: Date }, // 입대일 (入伍日)
    dischargeDate: { type: Date }, // 예정 전역일 (預計退伍日: 入伍+18個月)
    promoToIlbyung: { type: Date }, // 일병 진급일 (一兵: 入伍+3個月的1號)
    promoToSangbyung: { type: Date }, // 상병 진급일 (上兵: 入伍+9個月的1號)
    promoToByungjang: { type: Date }, // 병장 진급일 (兵長: 入伍+15個月的1號)
  },
  {
    timestamps: true,
  }
);

//
// 🔐 Multi-Tenant 핵심 인덱스
//

// 조직 내부에서만 군번 유일
userSchema.index({ organizationId: 1, serviceNumber: 1 }, { unique: true });

// 조직 + 부대 + 이름 검색 최적화
userSchema.index(
  { organizationId: 1, serviceNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { organizationId: { $exists: true, $ne: null } },
  }
);

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

module.exports = mongoose.model("User", userSchema);
