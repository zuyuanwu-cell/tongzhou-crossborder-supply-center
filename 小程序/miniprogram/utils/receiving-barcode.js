function isCancelled(error) {
  return String((error && error.errMsg) || "").toLowerCase().includes("cancel");
}

function notifyCaptured() {
  wx.showToast({ title: "条码已采集", icon: "success", duration: 1200 });
}

function scanReceivedBarcode(options) {
  const currentValue = String((options && options.currentValue) || "").trim();
  const onCaptured = options && options.onCaptured;
  wx.scanCode({
    onlyFromCamera: false,
    scanType: ["barCode", "qrCode", "datamatrix", "pdf417"],
    success(result) {
      const value = String((result && result.result) || "").trim();
      if (!value) {
        wx.showToast({ title: "未识别到条码，请重试", icon: "none" });
        return;
      }
      const apply = () => {
        if (typeof onCaptured === "function") onCaptured(value);
        notifyCaptured();
      };
      if (currentValue && currentValue !== value) {
        wx.showModal({
          title: "替换当前条码？",
          content: `当前为 ${currentValue}\n新扫描为 ${value}`,
          confirmText: "确认替换",
          confirmColor: "#2451A4",
          success(modalResult) { if (modalResult.confirm) apply(); },
        });
        return;
      }
      apply();
    },
    fail(error) {
      if (!isCancelled(error)) wx.showToast({ title: "扫码失败，请重试", icon: "none" });
    },
  });
}

module.exports = { scanReceivedBarcode };
