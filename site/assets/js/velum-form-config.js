/* ==========================================================================
   VELUM ENTERPRISE - contact form backend
   Google Forms. This is the ONLY file you edit to wire the form up.

   HOW TO FILL THIS IN
   -------------------
   1. In Google Forms (on the Workspace account), build a form with five
      questions, in this order and of these types:

        1. Nombre / Name              short answer   required
        2. Correo / Email             short answer   required
        3. Empresa / Company          short answer   optional
        4. Casa / House               short answer   optional
        5. Mensaje / Message          paragraph      required

      Use short answer for "Casa", not multiple choice. The website sends the
      house as free text, and Google rejects a multiple-choice answer that is
      not one of its listed options.

   2. Send > link, and copy the form's public URL. It looks like
        https://docs.google.com/forms/d/e/1FAIpQLSc..../viewform

   3. Run, from the repository root:
        python tools/google-form-ids.py "<that URL>"

      It prints this whole file, filled in. Paste over the block below.

   4. Commit and push. Netlify redeploys and the form is live.

   Responses land in the form's own Responses tab, and in a spreadsheet if you
   click the Sheets icon there. For email alerts: Responses > three-dot menu >
   "Get email notifications for new responses".
   ========================================================================== */

window.VELUM_FORM = {

  /* The long id between /d/e/ and /viewform. Leave empty to disable sending. */
  formId: "",

  /* Our field name -> the entry.NNNNNNN id Google assigned to that question. */
  fields: {
    nombre:  "",
    correo:  "",
    empresa: "",
    casa:    "",
    mensaje: ""
  },

  /* Shown if the send fails. Kept here so it stays in one place. */
  fallbackEmail: "support@velumcorp.com"
};
