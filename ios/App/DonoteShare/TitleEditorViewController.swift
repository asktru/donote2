import UIKit

/// The "Title" row's editor inside the share compose sheet: a text view
/// prefilled with the page title. Changes are reported live so the row's
/// value stays current when the user taps back.
class TitleEditorViewController: UIViewController, UITextViewDelegate {
    private let initialTitle: String
    private let onChange: (String) -> Void
    private let textView = UITextView()

    init(title: String, onChange: @escaping (String) -> Void) {
        self.initialTitle = title
        self.onChange = onChange
        super.init(nibName: nil, bundle: nil)
        self.title = "Note title"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        textView.text = initialTitle
        textView.font = .preferredFont(forTextStyle: .body)
        textView.delegate = self
        textView.textContainerInset = UIEdgeInsets(
            top: 12,
            left: 12,
            bottom: 12,
            right: 12
        )
        textView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(textView)

        NSLayoutConstraint.activate([
            textView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            textView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            textView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            textView.heightAnchor.constraint(equalToConstant: 120),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        textView.becomeFirstResponder()
    }

    func textViewDidChange(_ textView: UITextView) {
        onChange(textView.text ?? "")
    }
}
